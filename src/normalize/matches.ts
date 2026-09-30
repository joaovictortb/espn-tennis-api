import type {
  Competitor,
  Match,
  MatchState,
  MatchStatus,
  PreviousWinner,
  TournamentDetail,
  TournamentState,
  TournamentSummary,
  Tour,
} from "../domain/types.js";
import type { RawEvent, RawScoreboard } from "../espn/client.js";
import { toIso } from "../lib/dates.js";
import { athleteIdFromHref, num, playerFromScoreboard, playerLink, str, tourFromCategory, unique } from "./common.js";

const STATUS_OVERRIDES: Record<string, MatchState> = {
  STATUS_CANCELED: "canceled",
  STATUS_CANCELLED: "canceled",
  STATUS_POSTPONED: "postponed",
  STATUS_SUSPENDED: "suspended",
  STATUS_DELAYED: "suspended",
  STATUS_RAIN_DELAY: "suspended",
};

const STATE_BY_ESPN: Record<string, MatchState> = { pre: "scheduled", in: "live", post: "finished" };

export function normalizeStatus(raw: any): MatchStatus {
  const type = raw?.type ?? {};
  const code: string = type.name ?? "STATUS_UNKNOWN";
  const state = STATUS_OVERRIDES[code] ?? STATE_BY_ESPN[type.state] ?? "scheduled";
  return {
    state,
    code,
    detail: str(type.detail) ?? str(type.description),
    currentSet: state === "scheduled" ? null : num(raw?.period),
    endedBy: code === "STATUS_RETIRED" ? "retired" : code === "STATUS_WALKOVER" ? "walkover" : null,
  };
}

function normalizeCompetitor(c: any, live: boolean): Competitor {
  const isTeam = c?.type === "team";
  const players = isTeam
    ? (c?.roster?.athletes ?? []).map((a: any) => playerFromScoreboard(a)).filter(Boolean)
    : [playerFromScoreboard(c?.athlete, String(c?.id))].filter(Boolean);
  const seed = num(c?.curatedRank?.current);

  return {
    id: String(c?.id ?? ""),
    kind: isTeam ? "team" : "player",
    name: str(isTeam ? c?.roster?.displayName : c?.athlete?.displayName) ?? "TBD",
    shortName: str(isTeam ? c?.roster?.shortDisplayName : c?.athlete?.shortName),
    players,
    seed: seed !== null && seed > 0 && seed < 99 ? seed : null,
    winner: typeof c?.winner === "boolean" ? c.winner : null,
    serving: live && typeof c?.possession === "boolean" ? c.possession : null,
    sets: (Array.isArray(c?.linescores) ? c.linescores : []).map((s: any, i: number) => ({
      set: i + 1,
      games: num(s?.value) ?? 0,
      tiebreak: num(s?.tiebreak),
      won: typeof s?.winner === "boolean" ? s.winner : null,
    })),
  };
}

function broadcastNames(comp: any): string[] {
  const names: string[] = [];
  for (const b of comp?.broadcasts ?? []) {
    if (Array.isArray(b?.names)) names.push(...b.names);
    else if (b?.media?.shortName) names.push(b.media.shortName);
  }
  if (!names.length && str(comp?.broadcast)) names.push(comp.broadcast);
  return unique(names.filter((n) => typeof n === "string" && n));
}

export function normalizeMatch(
  comp: any,
  event: Pick<RawEvent, "id" | "name">,
  grouping: { slug?: string; displayName?: string } = {},
): Match {
  const status = normalizeStatus(comp?.status);
  const competitors = [...(comp?.competitors ?? [])]
    .sort((a: any, b: any) => (num(a?.order) ?? 9) - (num(b?.order) ?? 9))
    .map((c: any) => normalizeCompetitor(c, status.state === "live"));

  const category: string = comp?.type?.slug ?? grouping.slug ?? "unknown";
  return {
    id: String(comp?.id ?? ""),
    tour: tourFromCategory(category),
    tournament: { id: String(event.id), name: event.name ?? "" },
    category,
    categoryName: comp?.type?.text ?? grouping.displayName ?? "",
    round: { id: str(comp?.round?.id), name: str(comp?.round?.displayName) },
    startTime: toIso(comp?.startDate ?? comp?.date),
    timeConfirmed: comp?.timeValid !== false,
    status,
    bestOf: num(comp?.format?.regulation?.periods),
    court: str(comp?.venue?.court),
    location: str(comp?.venue?.fullName),
    summary: str(comp?.notes?.[0]?.text),
    competitors,
    winnerId: competitors.find((c) => c.winner === true)?.id ?? null,
    broadcasts: broadcastNames(comp),
  };
}

function previousWinners(raw: any[] | undefined): PreviousWinner[] {
  return (raw ?? []).map((w) => {
    const links = Array.isArray(w?.athletes) ? w.athletes.map((a: any) => playerLink(a?.links)) : [playerLink(w?.links)];
    return {
      category: w?.type?.slug ?? "unknown",
      name: str(w?.displayName) ?? "",
      playerIds: links.map(athleteIdFromHref).filter((x: string | null): x is string => !!x),
    };
  });
}

function tournamentState(event: RawEvent, matches: Match[], now: number): TournamentState {
  if (matches.some((m) => m.status.state === "live")) return "in_progress";
  const start = Date.parse(event.date ?? "");
  const end = Date.parse(event.endDate ?? "");
  if (matches.length) {
    const pending = matches.some((m) => m.status.state === "scheduled" || m.status.state === "suspended");
    const played = matches.some((m) => m.status.state === "finished");
    if (!pending && played) return "completed";
    if (played) return "in_progress";
  }
  if (!Number.isNaN(start) && now < start) return "upcoming";
  if (!Number.isNaN(end) && now > end) return "completed";
  return matches.length ? "upcoming" : "in_progress";
}

export function normalizeTournament(event: RawEvent, sourceTour: Tour | null, now = Date.now()): TournamentDetail {
  const matches: Match[] = [];
  const categories: TournamentSummary["categories"] = [];
  for (const g of event.groupings ?? []) {
    // The ATP feed of a combined event also carries the women's draw (and vice-versa): drop it.
    const groupTour = tourFromCategory(g.grouping?.slug);
    if (sourceTour && groupTour && groupTour !== sourceTour) continue;
    const comps = g.competitions ?? [];
    categories.push({ slug: g.grouping?.slug ?? "unknown", name: g.grouping?.displayName ?? "", matchCount: comps.length });
    for (const c of comps) matches.push(normalizeMatch(c, event, g.grouping));
  }
  matches.sort(compareMatches);

  const tours = unique(categories.map((c) => tourFromCategory(c.slug)).filter((t): t is Tour => !!t));
  if (!tours.length && sourceTour) tours.push(sourceTour);
  if (!tours.length && categories.some((c) => c.slug === "mixed-doubles")) tours.push("atp", "wta");

  return {
    id: String(event.id),
    tournamentId: String(event.id).split("-")[0],
    name: event.name ?? "",
    shortName: str(event.shortName),
    tours,
    isGrandSlam: event.major === true,
    startDate: toIso(event.date),
    endDate: toIso(event.endDate),
    location: str(event.venue?.displayName),
    state: tournamentState(event, matches, now),
    categories,
    previousWinners: previousWinners(event.previousWinners),
    bracketUrl: str(event.links?.find((l) => l.rel?.includes("bracket"))?.href),
    matches,
  };
}

export function normalizeScoreboard(raw: RawScoreboard, sourceTour: Tour | null, now = Date.now()): TournamentDetail[] {
  return (raw.events ?? []).map((e) => normalizeTournament(e, sourceTour, now));
}

export function toSummary({ matches: _matches, ...summary }: TournamentDetail): TournamentSummary {
  return summary;
}

/** Live first, then by start time, then id — stable ordering for UIs. */
export function compareMatches(a: Match, b: Match) {
  const live = Number(b.status.state === "live") - Number(a.status.state === "live");
  if (live) return live;
  const ta = a.startTime ? Date.parse(a.startTime) : Number.MAX_SAFE_INTEGER;
  const tb = b.startTime ? Date.parse(b.startTime) : Number.MAX_SAFE_INTEGER;
  return ta - tb || a.id.localeCompare(b.id);
}

/**
 * The same event (e.g. China Open 959-2026) appears in both ATP and WTA scoreboards.
 * Merge them so `tour=all` never shows duplicates.
 */
export function mergeTournaments(lists: TournamentDetail[][]): TournamentDetail[] {
  const byId = new Map<string, TournamentDetail>();
  for (const t of lists.flat()) {
    const existing = byId.get(t.id);
    if (!existing) {
      byId.set(t.id, { ...t, tours: [...t.tours], categories: [...t.categories], matches: [...t.matches] });
      continue;
    }
    existing.tours = unique([...existing.tours, ...t.tours]);
    const seenMatch = new Set(existing.matches.map((m) => m.id));
    existing.matches.push(...t.matches.filter((m) => !seenMatch.has(m.id)));
    existing.matches.sort(compareMatches);
    const seenCat = new Set(existing.categories.map((c) => c.slug));
    existing.categories.push(...t.categories.filter((c) => !seenCat.has(c.slug)));
    const seenWinner = new Set(existing.previousWinners.map((w) => w.category));
    existing.previousWinners.push(...t.previousWinners.filter((w) => !seenWinner.has(w.category)));
    if (t.state === "in_progress") existing.state = "in_progress";
  }
  return [...byId.values()].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.id.localeCompare(b.id));
}
