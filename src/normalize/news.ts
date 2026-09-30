import type { NewsArticle, Tour } from "../domain/types.js";
import { toIso } from "../lib/dates.js";
import { num, str, tourFromLeagueId, unique } from "./common.js";

/** Works for both site API `articles[]` and Now API `headlines[]` (same item shape). */
export function normalizeArticle(a: any): NewsArticle {
  const img = Array.isArray(a?.images) ? a.images[0] : a?.images;
  const categories: any[] = Array.isArray(a?.categories) ? a.categories : [];

  const tours = unique(
    categories
      .filter((c) => c?.type === "league")
      .map((c) => tourFromLeagueId(c?.leagueId ?? c?.league?.id))
      .filter((t): t is Tour => !!t),
  );
  const seen = new Set<string>();
  const players = categories
    .filter((c) => c?.type === "athlete" && c?.athleteId)
    .map((c) => ({ id: String(c.athleteId), name: str(c.description) ?? str(c.athlete?.description) ?? "" }))
    .filter((p) => !seen.has(p.id) && seen.add(p.id));

  return {
    id: String(a?.id ?? ""),
    headline: str(a?.headline) ?? str(a?.title) ?? "",
    description: str(a?.description),
    publishedAt: toIso(a?.published),
    updatedAt: toIso(a?.lastModified),
    url: str(a?.links?.web?.href),
    image: str(img?.url)
      ? {
          url: img.url,
          alt: str(img.alt) ?? str(img.caption),
          width: num(img.width),
          height: num(img.height),
          credit: str(img.credit),
        }
      : null,
    byline: str(a?.byline),
    premium: a?.premium === true,
    tours,
    players,
  };
}

export function normalizeNews(raw: any): NewsArticle[] {
  const items: any[] = raw?.articles ?? raw?.headlines ?? [];
  return items.map(normalizeArticle).filter((a) => a.id && a.headline);
}
