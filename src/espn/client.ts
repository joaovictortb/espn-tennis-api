import { fetchJson } from "../lib/http.js";
import type { Tour, TourParam } from "../domain/types.js";

/**
 * Thin, uncached ESPN fetchers. Caching happens in `services/` on the *normalised* data,
 * which is 10-50x smaller than ESPN's raw payloads.
 *
 * ESPN hosts (all undocumented, no key required):
 * - SITE: rich, denormalised JSON (scoreboard, rankings, news). Preferred source.
 * - CORE: normalised JSON full of `$ref` links. Used only for athlete profile/stats.
 * - WEB:  search.
 * - NOW:  news feed, supports filtering by athlete.
 */
export const ESPN = {
  SITE: "https://site.api.espn.com/apis/site/v2/sports/tennis",
  CORE: "https://sports.core.api.espn.com/v2/sports/tennis",
  WEB: "https://site.web.api.espn.com/apis",
  NOW: "https://now.core.api.espn.com/v1/sports/news",
  /** Full article body (HTML in `headlines[0].story`). */
  CONTENT: "https://content.core.api.espn.com/v1/sports/news",
} as const;

export const ALLOWED_RAW_HOSTS = new Set([
  "site.api.espn.com",
  "sports.core.api.espn.com",
  "site.web.api.espn.com",
  "now.core.api.espn.com",
]);

export function buildUrl(base: string, path: string, params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `${base}${path ? `/${path}` : ""}${s ? `?${s}` : ""}`;
}

/**
 * `dates` accepts "20260930", a range "20260929-20261001" or a year "2026".
 * Without `dates` ESPN returns every tournament running now. Either way each event comes
 * with its FULL draw (all rounds), not only the matches of that day.
 * A full season is ~20 MB of JSON.
 */
export const fetchScoreboard = (tour: TourParam, dates?: string) =>
  fetchJson<RawScoreboard>(buildUrl(ESPN.SITE, `${tour}/scoreboard`, { dates }));

export const fetchRankings = (tour: Tour) => fetchJson<any>(buildUrl(ESPN.SITE, `${tour}/rankings`));

/** Site news ignores `athlete=` filters; use `fetchNowNews` for that. */
export const fetchSiteNews = (tour: TourParam, limit: number) =>
  fetchJson<any>(buildUrl(ESPN.SITE, `${tour}/news`, { limit }));

export const fetchNewsStory = (id: string) =>
  fetchJson<any>(buildUrl(ESPN.CONTENT, encodeURIComponent(id)));

export const fetchNowNews = (p: { tour?: Tour; athleteId?: string; limit: number }) =>
  fetchJson<any>(buildUrl(ESPN.NOW, "", { sport: "tennis", leagues: p.tour, athletes: p.athleteId, limit: p.limit }));

/** League-less athlete resource: has flag, headshot, country and `$ref`s that reveal the tour. */
export const fetchAthlete = (id: string) => fetchJson<any>(buildUrl(ESPN.CORE, `athletes/${encodeURIComponent(id)}`));

export const fetchAthleteStats = (tour: Tour, id: string) =>
  fetchJson<any>(buildUrl(ESPN.CORE, `leagues/${tour}/athletes/${encodeURIComponent(id)}/statistics`));

export const fetchSearch = (q: string, limit: number) =>
  fetchJson<any>(buildUrl(ESPN.WEB, "search/v2", { query: q, sport: "tennis", limit }));

export const fetchRaw = (target: string) => fetchJson<unknown>(target);

// ---- Minimal raw typing (only what the normalisers rely on) ----

export interface RawScoreboard {
  leagues?: { slug?: string }[];
  events?: RawEvent[];
}

export interface RawEvent {
  id: string;
  date?: string;
  endDate?: string;
  major?: boolean;
  name?: string;
  shortName?: string;
  status?: { type?: { state?: string } };
  venue?: { displayName?: string };
  links?: { rel?: string[]; href?: string }[];
  previousWinners?: any[];
  groupings?: { grouping?: { slug?: string; displayName?: string }; competitions?: any[] }[];
}
