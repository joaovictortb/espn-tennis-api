import type { Country, Player, Tour } from "../domain/types.js";

const LEAGUE_TO_TOUR: Record<string, Tour> = { "851": "atp", "900": "wta" };

/**
 * Real circuit of a match category. Do not trust the league in match uids: combined events
 * (e.g. China Open) list women's matches with the ATP league id inside the ATP feed.
 * Mixed doubles belong to both tours → null.
 */
export function tourFromCategory(slug: unknown): Tour | null {
  if (typeof slug !== "string") return null;
  if (slug.startsWith("mens-")) return "atp";
  if (slug.startsWith("womens-")) return "wta";
  return null;
}

export const tourFromLeagueId =(id: unknown): Tour | null => LEAGUE_TO_TOUR[String(id)] ?? null;

/** "s:850~l:851~a:3782" -> "3782" */
export function athleteIdFromUid(uid: unknown): string | null {
  if (typeof uid !== "string") return null;
  return uid.match(/~a:(\d+)/)?.[1] ?? null;
}

/** ".../tennis/player/_/id/3782/carlos-alcaraz" -> "3782" */
export function athleteIdFromHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  return href.match(/\/id\/(\d+)/)?.[1] ?? null;
}

export const headshotUrl = (id: string) => `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png`;

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accepts `{ href, alt }` (scoreboard/core) or a plain URL + alt text (rankings).
 * Code comes from the flag file name: ".../countries/500/esp.png" -> "ESP".
 */
export function country(flag: unknown, altText?: unknown): Country {
  const href = typeof flag === "string" ? flag : str((flag as any)?.href);
  const name = str(altText) ?? str((flag as any)?.alt);
  const code = href?.match(/\/countries\/\d+\/([a-z]+)\.png/i)?.[1]?.toUpperCase() ?? null;
  return { code, name, flagUrl: href ?? null };
}

export function playerLink(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  const card = links.find((l: any) => Array.isArray(l?.rel) && l.rel.includes("playercard")) ?? links[0];
  return str(card?.href);
}

/** Player as embedded in scoreboard competitors / doubles rosters. */
export function playerFromScoreboard(a: any, fallbackId?: string): Player | null {
  if (!a) return null;
  const profileUrl = playerLink(a.links);
  const id = fallbackId ?? athleteIdFromHref(profileUrl);
  if (!id) return null;
  return {
    id,
    name: str(a.displayName) ?? str(a.fullName) ?? "Unknown",
    shortName: str(a.shortName),
    country: country(a.flag),
    headshotUrl: headshotUrl(id),
    profileUrl,
  };
}

export const unique = <T>(items: T[]) => [...new Set(items)];
