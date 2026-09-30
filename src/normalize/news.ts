import type { NewsArticle, NewsStory, Tour } from "../domain/types.js";
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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * ESPN story HTML → clean paragraphs. Drops embeds/markers (<photo1>,
 * <alsoSee>, inline video/social blocks) and keeps plain text only.
 */
export function storyParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  const blocks = html
    .replace(/<(script|style|iframe|blockquote)[\s\S]*?<\/\1>/gi, "")
    .split(/<\/p>|<br\s*\/?>|\n{2,}/i);
  return blocks
    .map((b) => decodeEntities(b.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1);
}

export function normalizeStory(raw: any): NewsStory | null {
  const item = raw?.headlines?.[0];
  if (!item) return null;
  const base = normalizeArticle(item);
  const imgs: any[] = Array.isArray(item.images) ? item.images : [];
  return {
    ...base,
    paragraphs: storyParagraphs(str(item.story)),
    images: imgs
      .filter((i) => str(i?.url))
      .map((i) => ({
        url: i.url,
        alt: str(i.alt) ?? str(i.caption),
        width: num(i.width),
        height: num(i.height),
        credit: str(i.credit),
      })),
  };
}
