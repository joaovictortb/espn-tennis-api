import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/lib/cache.js";

describe("TtlCache", () => {
  it("caches until ttl expires", async () => {
    let now = 0;
    const cache = new TtlCache(10, () => now);
    let calls = 0;
    const load = async () => ++calls;

    expect(await cache.get("k", 1000, load)).toEqual({ value: 1, cached: false });
    expect(await cache.get("k", 1000, load)).toEqual({ value: 1, cached: true });
    now = 1001;
    expect(await cache.get("k", 1000, load)).toEqual({ value: 2, cached: false });
  });

  it("de-duplicates concurrent loads", async () => {
    const cache = new TtlCache(10);
    let calls = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++calls), 10));
    const results = await Promise.all([cache.get("k", 1000, load), cache.get("k", 1000, load), cache.get("k", 1000, load)]);
    expect(calls).toBe(1);
    expect(results.map((r) => r.value)).toEqual([1, 1, 1]);
  });

  it("serves stale value when loader fails", async () => {
    let now = 0;
    const cache = new TtlCache(10, () => now);
    await cache.get("k", 10, async () => "old");
    now = 100;
    const r = await cache.get("k", 10, async () => {
      throw new Error("down");
    });
    expect(r).toEqual({ value: "old", cached: true });
  });

  it("evicts oldest entries beyond max size", async () => {
    const cache = new TtlCache(2);
    for (const k of ["a", "b", "c"]) await cache.get(k, 1000, async () => k);
    expect(cache.size).toBe(2);
    let reloaded = false;
    await cache.get("a", 1000, async () => ((reloaded = true), "a"));
    expect(reloaded).toBe(true);
  });
});
