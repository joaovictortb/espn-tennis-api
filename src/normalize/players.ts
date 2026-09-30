import type { Match, PlayerProfile, PlayerSearchResult, PlayerSeason, Rankings, Tour } from "../domain/types.js";
import { toIso } from "../lib/dates.js";
import { athleteIdFromUid, country, headshotUrl, num, playerLink, str } from "./common.js";

/** The league-less athlete resource links to `/leagues/atp/...` or `/leagues/wta/...` stats/eventlog. */
export function tourFromAthlete(athlete: any): Tour | null {
  for (const key of ["eventLog", "statistics", "ranks"]) {
    const m = String(athlete?.[key]?.$ref ?? "").match(/\/leagues\/(atp|wta)\//);
    if (m) return m[1] as Tour;
  }
  return null;
}

const INCH_TO_CM = 2.54;
const LB_TO_KG = 0.45359237;
const round1 = (n: number) => Math.round(n * 10) / 10;

function careerStat(stats: any, name: string): number | null {
  for (const cat of stats?.splits?.categories ?? []) {
    const s = (cat?.stats ?? []).find((x: any) => x?.name === name);
    if (s) return num(s.value);
  }
  return null;
}

export function normalizeProfile(
  athlete: any,
  stats: any | null,
  tour: Tour,
  rankings: Rankings | null,
): PlayerProfile {
  const id = String(athlete?.id ?? "");
  const height = num(athlete?.height);
  const weight = num(athlete?.weight);
  const hand = String(athlete?.hand?.type ?? "").toLowerCase();
  const ranked = rankings?.entries.find((e) => e.player.id === id);

  return {
    id,
    name: str(athlete?.displayName) ?? str(athlete?.fullName) ?? "",
    shortName: str(athlete?.shortName),
    firstName: str(athlete?.firstName),
    lastName: str(athlete?.lastName),
    tour,
    country: athlete?.citizenshipCountry?.abbreviation
      ? {
          code: athlete.citizenshipCountry.abbreviation,
          name: str(athlete.citizenshipCountry.name) ?? str(athlete?.flag?.alt),
          flagUrl: str(athlete?.flag?.href),
        }
      : country(athlete?.flag),
    headshotUrl: str(athlete?.headshot?.href) ?? (id ? headshotUrl(id) : null),
    profileUrl: playerLink(athlete?.links),
    birthDate: toIso(athlete?.dateOfBirth)?.slice(0, 10) ?? null,
    age: num(athlete?.age),
    birthPlace: str(athlete?.birthPlace?.summary) ?? str(athlete?.birthPlace?.city),
    heightCm: height ? round1(height * INCH_TO_CM) : null,
    heightDisplay: str(athlete?.displayHeight),
    weightKg: weight ? round1(weight * LB_TO_KG) : null,
    weightDisplay: str(athlete?.displayWeight),
    hand: hand === "right" || hand === "left" ? hand : null,
    turnedPro: num(athlete?.debutYear),
    active: typeof athlete?.active === "boolean" ? athlete.active : null,
    ranking: ranked
      ? { rank: ranked.rank, points: ranked.points, previousRank: ranked.previousRank, updatedAt: rankings!.updatedAt }
      : null,
    career: {
      singlesWon: careerStat(stats, "singlesWon"),
      singlesLost: careerStat(stats, "singlesLost"),
      singlesTitles: careerStat(stats, "singlesTitles"),
      doublesTitles: careerStat(stats, "doublesTitles"),
      prizeMoneyUsd: careerStat(stats, "prize"),
    },
  };
}

export function normalizeSearch(raw: any): PlayerSearchResult[] {
  const group = (raw?.results ?? []).find((r: any) => r?.type === "player");
  return (group?.contents ?? [])
    .filter((p: any) => p?.sport === "tennis" || String(p?.uid ?? "").startsWith("s:850"))
    .map((p: any) => {
      const id = athleteIdFromUid(p?.uid);
      const league = String(p?.defaultLeagueSlug ?? "");
      return {
        id,
        name: str(p?.displayName) ?? "",
        tour: league === "atp" || league === "wta" ? league : null,
        headshotUrl: str(p?.image?.default) ?? (id ? headshotUrl(id) : null),
        profileUrl: str(p?.link?.web),
      };
    })
    .filter((p: PlayerSearchResult) => !!p.id);
}

/** Season record computed from played matches (walkovers excluded from W/L, like ATP/WTA do). */
export function buildPlayerSeason(playerId: string, tour: Tour, year: number, all: Match[]): PlayerSeason {
  const matches = all
    .filter((m) => m.competitors.some((c) => c.players.some((p) => p.id === playerId)))
    .sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));

  const singles = { wins: 0, losses: 0, titles: 0 };
  const doubles = { wins: 0, losses: 0, titles: 0 };
  for (const m of matches) {
    if (m.status.state !== "finished" || m.status.endedBy === "walkover" || !m.winnerId) continue;
    const mine = m.competitors.find((c) => c.players.some((p) => p.id === playerId));
    if (!mine) continue;
    const bucket = m.category.endsWith("singles") ? singles : doubles;
    if (mine.id === m.winnerId) {
      bucket.wins++;
      if (m.round.name === "Final") bucket.titles++;
    } else {
      bucket.losses++;
    }
  }
  return { playerId, tour, year, record: { singles, doubles }, matches };
}
