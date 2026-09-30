import { config } from "../config.js";
import type {
  Match,
  MatchState,
  NewsArticle,
  NewsStory,
  PlayerProfile,
  PlayerSearchResult,
  PlayerSeason,
  Rankings,
  TournamentDetail,
  Tour,
  TourParam,
} from "../domain/types.js";
import * as espn from "../espn/client.js";
import { TtlCache } from "../lib/cache.js";
import { addDays, dayInTimezone, todayIn, toEspnDate } from "../lib/dates.js";
import { UpstreamError, notFound } from "../lib/errors.js";
import { normalizeNews, normalizeStory } from "../normalize/news.js";
import { buildPlayerSeason, normalizeProfile, normalizeSearch, tourFromAthlete } from "../normalize/players.js";
import { normalizeRankings } from "../normalize/rankings.js";
import { compareMatches, mergeTournaments, normalizeScoreboard } from "../normalize/matches.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

export const TOURS: Tour[] = ["atp", "wta"];

export const cache = new TtlCache(config.cacheMaxEntries);

/** Result + whether it came from cache, so routes can expose it in `meta`. */
export type Result<T> = { value: T; cached: boolean };

const sourceTour = (tour: TourParam) => (tour === "all" ? null : tour);

const mapUpstream404 = (message: string) => (err: unknown) => {
  // ESPN answers 400 (not 404) for unknown athlete / event ids.
  if (err instanceof UpstreamError && (err.upstreamStatus === 404 || err.upstreamStatus === 400)) throw notFound(message);
  throw err;
};

// ---------------------------------------------------------------- tournaments / matches

/** Tournaments running right now, with full draws. 20s TTL — this is the "live" source. */
export function currentTournaments(tour: TourParam): Promise<Result<TournamentDetail[]>> {
  return cache.get(`now:${tour}`, 20 * SEC, async () =>
    normalizeScoreboard(await espn.fetchScoreboard(tour), sourceTour(tour)),
  );
}

/**
 * Tournaments active on one ESPN (US/Eastern) day, YYYY-MM-DD.
 * Do NOT use ESPN date ranges ("20260929-20261001"): they return unrelated events.
 */
function tournamentsOnEspnDay(tour: TourParam, date: string, ttlMs: number) {
  return cache.get(`day:${tour}:${date}`, ttlMs, async () =>
    normalizeScoreboard(await espn.fetchScoreboard(tour, toEspnDate(date)), sourceTour(tour)),
  );
}

/** Whole season, normalised. ~20 MB raw per tour → a few MB normalised, cached. */
export async function season(tour: TourParam, year: number): Promise<Result<TournamentDetail[]>> {
  if (tour === "all") {
    // Compose from the per-tour caches instead of downloading both seasons again.
    const parts = await Promise.all(TOURS.map((t) => season(t, year)));
    return { value: mergeTournaments(parts.map((p) => p.value)), cached: parts.every((p) => p.cached) };
  }
  const ttl = year >= new Date().getUTCFullYear() ? 15 * MIN : 24 * HOUR;
  return cache.get(`season:${tour}:${year}`, ttl, async () =>
    normalizeScoreboard(await espn.fetchScoreboard(tour, String(year)), tour),
  );
}

export interface MatchFilters {
  status?: MatchState[];
  category?: string;
  tournamentId?: string;
  playerId?: string;
  /** ESPN country code (IOC-style: BRA, GER, SUI...). Match kept if any player is from it. */
  country?: string;
}

export function filterMatches(matches: Match[], f: MatchFilters) {
  const country = f.country?.toUpperCase();
  return matches.filter(
    (m) =>
      (!f.status?.length || f.status.includes(m.status.state)) &&
      (!f.category || m.category === f.category) &&
      (!f.tournamentId || m.tournament.id === f.tournamentId) &&
      (!f.playerId || m.competitors.some((c) => c.players.some((p) => p.id === f.playerId))) &&
      (!country || m.competitors.some((c) => c.players.some((p) => p.country.code === country))),
  );
}

/**
 * Matches whose start time falls on `date` in timezone `tz`.
 * ESPN's day boundaries are US/Eastern, so we query date-1, date and date+1 (each cached on its own,
 * so neighbouring days share entries) and filter by local day.
 */
export async function matchesOnDay(tour: TourParam, date: string, tz: string): Promise<Result<Match[]>> {
  const today = todayIn(tz);
  const ttlFor = (d: string) => (d < addDays(today, -1) ? 1 * HOUR : d > addDays(today, 1) ? 10 * MIN : 30 * SEC);
  const days = [addDays(date, -1), date, addDays(date, 1)];
  const results = await Promise.all(days.map((d) => tournamentsOnEspnDay(tour, d, ttlFor(d))));
  const seen = new Set<string>();
  const matches = results
    .flatMap((r) => r.value)
    .flatMap((t) => t.matches)
    .filter((m) => m.startTime && dayInTimezone(m.startTime, tz) === date && !seen.has(m.id) && seen.add(m.id))
    .sort(compareMatches);
  return { value: matches, cached: results.every((r) => r.cached) };
}

export async function liveMatches(tour: TourParam): Promise<Result<Match[]>> {
  const { value, cached } = await currentTournaments(tour);
  return { value: value.flatMap((t) => t.matches).filter((m) => m.status.state === "live").sort(compareMatches), cached };
}

/** Looks in current tournaments first (fresh), then in the current season. */
export async function findMatch(id: string, tour: TourParam): Promise<Result<Match>> {
  const now = await currentTournaments(tour);
  const hit = now.value.flatMap((t) => t.matches).find((m) => m.id === id);
  if (hit) return { value: hit, cached: now.cached };

  const s = await season(tour, new Date().getUTCFullYear());
  const old = s.value.flatMap((t) => t.matches).find((m) => m.id === id);
  if (!old) throw notFound(`Match ${id} not found in current tournaments or this season`);
  return { value: old, cached: s.cached };
}

/** `id` is the ESPN event id "959-2026". Live data is preferred while the event is running. */
export async function findTournament(id: string, tour: TourParam): Promise<Result<TournamentDetail>> {
  const now = await currentTournaments(tour);
  const live = now.value.find((t) => t.id === id);
  if (live) return { value: live, cached: now.cached };

  const year = Number(id.split("-")[1]) || new Date().getUTCFullYear();
  const s = await season(tour, year);
  const t = s.value.find((x) => x.id === id);
  if (!t) throw notFound(`Tournament ${id} not found for tour=${tour} in ${year}`);
  return { value: t, cached: s.cached };
}

// ---------------------------------------------------------------- rankings / news / search

export function rankings(tour: Tour): Promise<Result<Rankings>> {
  return cache.get(`rankings:${tour}`, 1 * HOUR, async () => normalizeRankings(await espn.fetchRankings(tour), tour));
}

export function news(p: { tour: TourParam; limit: number; playerId?: string }): Promise<Result<NewsArticle[]>> {
  const key = `news:${p.tour}:${p.playerId ?? ""}:${p.limit}`;
  return cache.get(key, 5 * MIN, async () => {
    const raw = p.playerId
      ? await espn.fetchNowNews({ tour: sourceTour(p.tour) ?? undefined, athleteId: p.playerId, limit: p.limit })
      : await espn.fetchSiteNews(p.tour, p.limit);
    return normalizeNews(raw).slice(0, p.limit);
  });
}

/** One article with the full text. Articles don't change much: 1 h cache. */
export async function newsStory(id: string): Promise<Result<NewsStory>> {
  const r = await cache.get(`story:${id}`, 1 * HOUR, async () => {
    const story = normalizeStory(await espn.fetchNewsStory(id).catch(mapUpstream404(`News ${id} not found`)));
    if (!story) throw notFound(`News ${id} not found`);
    return story;
  });
  return r;
}

export function searchPlayers(q: string, limit: number): Promise<Result<PlayerSearchResult[]>> {
  return cache.get(`search:${q.toLowerCase()}:${limit}`, 10 * MIN, async () =>
    normalizeSearch(await espn.fetchSearch(q, limit)).slice(0, limit),
  );
}

// ---------------------------------------------------------------- players

async function athleteRaw(id: string) {
  return cache.get(`athlete:${id}`, 6 * HOUR, () =>
    espn.fetchAthlete(id).catch(mapUpstream404(`Player ${id} not found`)),
  );
}

/** Resolves the tour of a player when the client does not send it. */
export async function resolvePlayerTour(id: string, tour?: Tour): Promise<Tour> {
  if (tour) return tour;
  const { value } = await athleteRaw(id);
  return tourFromAthlete(value) ?? "atp";
}

export async function playerProfile(id: string, tourParam?: Tour): Promise<Result<PlayerProfile>> {
  const athlete = await athleteRaw(id);
  const tour = tourParam ?? tourFromAthlete(athlete.value) ?? "atp";
  const [stats, ranks] = await Promise.all([
    cache.get(`athlete-stats:${tour}:${id}`, 1 * HOUR, () => espn.fetchAthleteStats(tour, id).catch(() => null)),
    rankings(tour).catch(() => null),
  ]);
  return {
    value: normalizeProfile(athlete.value, stats.value, tour, ranks?.value ?? null),
    cached: athlete.cached && stats.cached,
  };
}

export async function playerSeason(id: string, tour: Tour, year: number): Promise<Result<PlayerSeason>> {
  const s = await season(tour, year);
  const matches = s.value.flatMap((t) => t.matches);
  return { value: buildPlayerSeason(id, tour, year, matches), cached: s.cached };
}

// ---------------------------------------------------------------- raw passthrough

export function raw(target: string) {
  return cache.get(`raw:${target}`, 1 * MIN, () => espn.fetchRaw(target));
}
