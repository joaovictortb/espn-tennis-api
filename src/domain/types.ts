/**
 * Public response contract of this API. Everything returned under /v1 uses these shapes.
 * ESPN raw payloads never leak out of `src/espn` + `src/normalize` (except `/v1/raw`).
 */

export type Tour = "atp" | "wta";
export type TourParam = Tour | "all";

export interface Country {
  /** ESPN country code taken from the flag file name (e.g. "ESP", "BRA"). Not always ISO. */
  code: string | null;
  name: string | null;
  flagUrl: string | null;
}

export interface Player {
  id: string;
  name: string;
  shortName: string | null;
  country: Country;
  /** Best-effort ESPN CDN URL; may 404 for lower-ranked players — use a placeholder on error. */
  headshotUrl: string | null;
  profileUrl: string | null;
}

export type MatchState = "scheduled" | "live" | "finished" | "canceled" | "postponed" | "suspended";

export interface MatchStatus {
  state: MatchState;
  /** Raw ESPN status name, e.g. STATUS_FINAL, STATUS_RETIRED, STATUS_WALKOVER, STATUS_IN_PROGRESS. */
  code: string;
  /** Human label from ESPN, e.g. "2nd Set", "Final", "Retired", "9/30 - 11:00 PM EDT". */
  detail: string | null;
  /** Current set number while live, last set played when finished. */
  currentSet: number | null;
  /** "retired" | "walkover" when the match ended early, otherwise null. */
  endedBy: "retired" | "walkover" | null;
}

export interface SetScore {
  set: number;
  games: number;
  /** Tie-break points, only when the set went to a tie-break. */
  tiebreak: number | null;
  /** true = won this set, false = lost, null = set still in progress/unknown. */
  won: boolean | null;
}

export interface Competitor {
  /** ESPN competitor id. Singles = player id. Doubles = "id1-id2". */
  id: string;
  kind: "player" | "team";
  name: string;
  shortName: string | null;
  players: Player[];
  seed: number | null;
  winner: boolean | null;
  /** true when this side is serving right now (live only). */
  serving: boolean | null;
  sets: SetScore[];
}

export type MatchCategory =
  | "mens-singles"
  | "womens-singles"
  | "mens-doubles"
  | "womens-doubles"
  | "mixed-doubles"
  | string;

export interface Match {
  id: string;
  /** From the category: mens-* = atp, womens-* = wta, mixed-doubles = null. */
  tour: Tour | null;
  tournament: { id: string; name: string };
  category: MatchCategory;
  categoryName: string;
  round: { id: string | null; name: string | null };
  /** ISO-8601 UTC. */
  startTime: string | null;
  /** false when ESPN only knows the day (time is a placeholder / "followed by"). */
  timeConfirmed: boolean;
  status: MatchStatus;
  /** Max sets (3 or 5). */
  bestOf: number | null;
  court: string | null;
  location: string | null;
  /** ESPN one-line summary: "(1) A. Player (ESP) bt B. Player (ITA) 6-3 6-4". */
  summary: string | null;
  /** Always [home/order 1, away/order 2]. */
  competitors: Competitor[];
  winnerId: string | null;
  broadcasts: string[];
}

export type TournamentState = "upcoming" | "in_progress" | "completed";

export interface PreviousWinner {
  category: MatchCategory;
  name: string;
  playerIds: string[];
}

export interface TournamentSummary {
  /** ESPN event id, e.g. "959-2026" (tournamentId-year). Use this in /v1/tournaments/:id. */
  id: string;
  tournamentId: string;
  name: string;
  shortName: string | null;
  tours: Tour[];
  isGrandSlam: boolean;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  state: TournamentState;
  categories: { slug: MatchCategory; name: string; matchCount: number }[];
  previousWinners: PreviousWinner[];
  bracketUrl: string | null;
}

export interface TournamentDetail extends TournamentSummary {
  matches: Match[];
}

export interface RankingEntry {
  rank: number;
  previousRank: number | null;
  /** previousRank - rank. Positive = moved up. */
  movement: number | null;
  points: number | null;
  player: Player & {
    firstName: string | null;
    lastName: string | null;
    age: number | null;
    birthPlace: string | null;
  };
}

export interface Rankings {
  tour: Tour;
  name: string;
  updatedAt: string | null;
  entries: RankingEntry[];
}

export interface NewsArticle {
  id: string;
  headline: string;
  description: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  url: string | null;
  image: { url: string; alt: string | null; width: number | null; height: number | null; credit: string | null } | null;
  byline: string | null;
  premium: boolean;
  tours: Tour[];
  players: { id: string; name: string }[];
}

/** One article with its full body, as plain-text paragraphs (no ESPN HTML). */
export interface NewsStory extends NewsArticle {
  paragraphs: string[];
  images: { url: string; alt: string | null; width: number | null; height: number | null; credit: string | null }[];
}

export interface PlayerSearchResult {
  id: string;
  name: string;
  tour: Tour | null;
  headshotUrl: string | null;
  profileUrl: string | null;
}

export interface PlayerProfile extends Player {
  firstName: string | null;
  lastName: string | null;
  tour: Tour;
  birthDate: string | null;
  age: number | null;
  birthPlace: string | null;
  heightCm: number | null;
  heightDisplay: string | null;
  weightKg: number | null;
  weightDisplay: string | null;
  hand: "right" | "left" | null;
  turnedPro: number | null;
  active: boolean | null;
  ranking: { rank: number; points: number | null; previousRank: number | null; updatedAt: string | null } | null;
  /** Career totals from ESPN. */
  career: {
    singlesWon: number | null;
    singlesLost: number | null;
    singlesTitles: number | null;
    doublesTitles: number | null;
    prizeMoneyUsd: number | null;
  };
}

export interface PlayerSeason {
  playerId: string;
  tour: Tour;
  year: number;
  /** Computed from ESPN match data. Walkovers are not counted (ATP/WTA convention). */
  record: {
    singles: { wins: number; losses: number; titles: number };
    doubles: { wins: number; losses: number; titles: number };
  };
  /** Most recent first. */
  matches: Match[];
}
