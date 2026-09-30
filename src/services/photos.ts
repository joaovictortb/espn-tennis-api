/**
 * Player photos. ESPN only has headshots for part of the tour (the CDN URL is
 * built from the id and 404s for the rest), so the API resolves each player
 * once, in the background, in this order:
 *   1. ESPN headshot (HEAD request — does it really exist?)
 *   2. TheSportsDB (free key "3", ~30 req/min) — transparent cut-out
 *   3. Wikipedia page image (free-licensed only)
 * Results (including "no photo") are kept in memory and, when SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set, persisted in `pro_player_photos` so they
 * survive restarts (Render free tier sleeps and wipes memory).
 *
 * `applyPhotos` walks any response payload and rewrites `headshotUrl` for every
 * object that has `id` + `headshotUrl`. Unknown ids keep the ESPN guess and are
 * queued for resolution.
 */
import { config } from "../config.js";

type Source = "espn" | "thesportsdb" | "wikipedia" | "none";
type PhotoRow = { url: string | null; source: Source; checkedAt: number };

const UA = "espn-tennis-api/2.0 (player photos; 0-40)";
/** "No photo" results are retried after this. */
const RETRY_NONE_MS = 7 * 24 * 3600_000;
const SPORTSDB_GAP_MS = 2_100;
const WIKI_GAP_MS = 1_100;

const store = new Map<string, PhotoRow>();
const queue = new Map<string, { name: string; espnUrl: string | null }>();
let working = false;
let loaded: Promise<void> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const supabase = () =>
  config.supabaseUrl && config.supabaseServiceKey
    ? { url: `${config.supabaseUrl}/rest/v1/pro_player_photos`, key: config.supabaseServiceKey }
    : null;

/** Loads the persisted photos once (called at boot and lazily). */
export function loadPhotos(): Promise<void> {
  loaded ??= (async () => {
    const db = supabase();
    if (!db) return;
    try {
      const res = await fetch(`${db.url}?select=espn_id,url,source,checked_at`, {
        headers: { apikey: db.key, Authorization: `Bearer ${db.key}` },
      });
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{ espn_id: string; url: string | null; source: Source; checked_at: string }>;
      for (const r of rows) {
        store.set(r.espn_id, { url: r.url, source: r.source, checkedAt: Date.parse(r.checked_at) || 0 });
      }
    } catch {
      // DB unavailable: memory-only until next restart
    }
  })();
  return loaded;
}

async function persist(id: string, name: string, row: PhotoRow) {
  store.set(id, row);
  const db = supabase();
  if (!db) return;
  try {
    await fetch(db.url, {
      method: "POST",
      headers: {
        apikey: db.key,
        Authorization: `Bearer ${db.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        espn_id: id,
        name,
        url: row.url,
        source: row.source,
        checked_at: new Date(row.checkedAt).toISOString(),
      }),
    });
  } catch {
    // keep in memory; persisted on a later resolution
  }
}

/** Rewrites `headshotUrl` in place. Safe on any JSON-like value. */
export function applyPhotos(payload: unknown): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.id === "string" && "headshotUrl" in obj) {
      const id = obj.id;
      const hit = store.get(id);
      if (hit && (hit.url || Date.now() - hit.checkedAt < RETRY_NONE_MS)) {
        obj.headshotUrl = hit.url;
      } else if (typeof obj.name === "string" && /^\d+$/.test(id)) {
        enqueue(id, obj.name, typeof obj.headshotUrl === "string" ? obj.headshotUrl : null);
      }
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(payload);
}

function enqueue(id: string, name: string, espnUrl: string | null) {
  if (queue.has(id)) return;
  queue.set(id, { name, espnUrl });
  void work();
}

async function work() {
  if (working) return;
  working = true;
  try {
    await loadPhotos();
    for (const [id, p] of queue) {
      const known = store.get(id);
      if (!known || (!known.url && Date.now() - known.checkedAt >= RETRY_NONE_MS)) {
        const found = await resolve(p.name, p.espnUrl);
        await persist(id, p.name, { ...found, checkedAt: Date.now() });
      }
      queue.delete(id);
    }
  } finally {
    working = false;
    if (queue.size > 0) void work();
  }
}

async function resolve(name: string, espnUrl: string | null): Promise<{ url: string | null; source: Source }> {
  if (espnUrl && (await exists(espnUrl))) return { url: espnUrl, source: "espn" };
  const sdb = await fromSportsDb(name);
  if (sdb) return { url: sdb, source: "thesportsdb" };
  const wiki = await fromWikipedia(name);
  if (wiki) return { url: wiki, source: "wikipedia" };
  return { url: null, source: "none" };
}

async function exists(url: string) {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

async function fromSportsDb(name: string): Promise<string | null> {
  await sleep(SPORTSDB_GAP_MS);
  try {
    const res = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(name.replace(/ /g, "_"))}`,
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      player?: Array<{ strSport?: string; strCutout?: string | null; strThumb?: string | null }> | null;
    };
    const hit = (body.player ?? []).find((x) => x.strSport === "Tennis");
    return hit?.strCutout || hit?.strThumb || null;
  } catch {
    return null;
  }
}

/** Page image of the English Wikipedia article, free licence only. */
async function fromWikipedia(name: string): Promise<string | null> {
  for (const title of [name, `${name} (tennis)`]) {
    await sleep(WIKI_GAP_MS);
    try {
      const q = new URLSearchParams({
        action: "query",
        titles: title,
        prop: "pageimages|description",
        piprop: "thumbnail",
        pithumbsize: "240",
        pilicense: "free",
        redirects: "1",
        format: "json",
      });
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, { headers: { "User-Agent": UA } });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        query?: { pages?: Record<string, { description?: string; thumbnail?: { source?: string } }> };
      };
      const page = Object.values(body.query?.pages ?? {})[0];
      if (page?.thumbnail?.source && (page.description ?? "").toLowerCase().includes("tennis")) {
        return page.thumbnail.source;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** For /health: how many players are resolved and how many wait in line. */
export function photoStats() {
  const bySource: Record<string, number> = {};
  for (const row of store.values()) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  return { resolved: store.size, queued: queue.size, persisted: Boolean(supabase()), bySource };
}
