import type { RankingEntry, Rankings, Tour } from "../domain/types.js";
import { toIso } from "../lib/dates.js";
import { country, headshotUrl, num, playerLink, str } from "./common.js";

export function normalizeRankings(raw: any, tour: Tour): Rankings {
  const list = raw?.rankings?.[0] ?? {};
  const entries: RankingEntry[] = (list.ranks ?? []).map((r: any) => {
    const a = r?.athlete ?? {};
    const id = String(a.id ?? "");
    const rank = num(r?.current) ?? 0;
    const previousRank = num(r?.previous);
    return {
      rank,
      previousRank,
      movement: previousRank !== null && rank ? previousRank - rank : null,
      points: num(r?.points),
      player: {
        id,
        name: str(a.displayName) ?? "",
        shortName: str(a.shortname) ?? str(a.shortName),
        firstName: str(a.firstName),
        lastName: str(a.lastName),
        country: country(a.flag, a.flagAltText),
        headshotUrl: str(a.headshot) ?? (id ? headshotUrl(id) : null),
        profileUrl: playerLink(a.links),
        age: num(a.age),
        birthPlace: str(a.birthPlace?.summary),
      },
    };
  });

  return {
    tour,
    name: str(list.name) ?? tour.toUpperCase(),
    updatedAt: toIso(list.update),
    entries: entries.sort((x, y) => x.rank - y.rank),
  };
}
