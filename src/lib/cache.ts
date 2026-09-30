type Entry = { value: unknown; expiresAt: number };

/**
 * In-memory TTL cache with:
 * - in-flight de-duplication (N concurrent requests for the same key = 1 upstream call)
 * - stale-if-error (if the loader fails and an expired value exists, serve it)
 * - LRU-ish eviction by insertion order once `maxEntries` is reached
 */
export class TtlCache {
  private readonly store = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > this.now()) {
      // refresh position for LRU
      this.store.delete(key);
      this.store.set(key, hit);
      return { value: hit.value as T, cached: true };
    }

    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = loader()
        .then((value) => {
          this.set(key, value, ttlMs);
          return value;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }

    try {
      return { value: await pending, cached: false };
    } catch (err) {
      if (hit) return { value: hit.value as T, cached: true };
      throw err;
    }
  }

  set(key: string, value: unknown, ttlMs: number) {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}
