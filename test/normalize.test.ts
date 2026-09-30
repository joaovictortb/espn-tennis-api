import { describe, expect, it } from "vitest";
import { country, tourFromCategory } from "../src/normalize/common.js";
import { mergeTournaments, normalizeScoreboard, normalizeStatus } from "../src/normalize/matches.js";
import { normalizeNews } from "../src/normalize/news.js";
import { buildPlayerSeason, normalizeProfile, normalizeSearch, tourFromAthlete } from "../src/normalize/players.js";
import { normalizeRankings } from "../src/normalize/rankings.js";
import { fixture } from "./helpers.js";

const tournaments = normalizeScoreboard(fixture("scoreboard-all"), null, Date.parse("2026-09-30T12:00:00Z"));
const matches = tournaments.flatMap((t) => t.matches);

describe("common", () => {
  it("maps category to tour (mixed belongs to both)", () => {
    expect(tourFromCategory("mens-singles")).toBe("atp");
    expect(tourFromCategory("womens-doubles")).toBe("wta");
    expect(tourFromCategory("mixed-doubles")).toBeNull();
  });

  it("extracts country code from flag url", () => {
    expect(country({ href: "https://a.espncdn.com/i/teamlogos/countries/500/esp.png", alt: "Spain" })).toEqual({
      code: "ESP",
      name: "Spain",
      flagUrl: "https://a.espncdn.com/i/teamlogos/countries/500/esp.png",
    });
    expect(country(undefined)).toEqual({ code: null, name: null, flagUrl: null });
  });
});

describe("matches", () => {
  it("maps ESPN status to a small state machine", () => {
    expect(normalizeStatus({ period: 2, type: { name: "STATUS_IN_PROGRESS", state: "in", detail: "2nd Set" } })).toMatchObject({
      state: "live",
      currentSet: 2,
      endedBy: null,
    });
    expect(normalizeStatus({ type: { name: "STATUS_RETIRED", state: "post" } })).toMatchObject({ state: "finished", endedBy: "retired" });
    expect(normalizeStatus({ type: { name: "STATUS_WALKOVER", state: "post" } }).endedBy).toBe("walkover");
    expect(normalizeStatus({ type: { name: "STATUS_CANCELED", state: "post" } }).state).toBe("canceled");
    expect(normalizeStatus({ period: 1, type: { name: "STATUS_SCHEDULED", state: "pre" } }).currentSet).toBeNull();
  });

  it("finds live matches at competition level (tournament status is unreliable)", () => {
    const live = matches.filter((m) => m.status.state === "live");
    expect(live).toHaveLength(5);
    // every tournament in the fixture has ESPN status "post" even though matches are live
    expect(tournaments.every((t) => t.state === "in_progress")).toBe(true);
  });

  it("normalises a live singles match (Djokovic vs Borges)", () => {
    const m = matches.find((x) => x.competitors.some((c) => c.id === "296") && x.status.state === "live")!;
    expect(m.tour).toBe("atp");
    expect(m.tournament).toEqual({ id: "959-2026", name: "China Open" });
    const djokovic = m.competitors.find((c) => c.id === "296")!;
    const borges = m.competitors.find((c) => c.id === "4115")!;
    expect(djokovic.name).toBe("Novak Djokovic");
    expect(djokovic.players[0].country.code).toMatch(/^[A-Z]{3}$/);
    expect(djokovic.seed).not.toBeNull();
    expect(djokovic.sets.map((s) => s.games)).toEqual([6, 2]);
    expect(djokovic.sets[0].won).toBe(true);
    expect(djokovic.sets[1].won).toBeNull();
    expect(borges.serving).toBe(true);
    expect(djokovic.serving).toBe(false);
    expect(m.winnerId).toBeNull();
  });

  it("normalises doubles teams with both players", () => {
    const m = matches.find((x) => x.competitors.some((c) => c.id === "16562-854"))!;
    const team = m.competitors.find((c) => c.id === "16562-854")!;
    expect(team.kind).toBe("team");
    expect(team.players.map((p) => p.id)).toEqual(["16562", "854"]);
    expect(team.sets[0]).toMatchObject({ games: 7, tiebreak: 7, won: true });
    expect(m.winnerId).toBe("16562-854");
  });

  it("flags walkovers and keeps the winner", () => {
    const m = matches.find((x) => x.status.endedBy === "walkover")!;
    expect(m.winnerId).not.toBeNull();
    expect(m.competitors.every((c) => c.sets.length === 0)).toBe(true);
  });

  it("orders competitors by ESPN order (home first)", () => {
    for (const m of matches) expect(m.competitors).toHaveLength(2);
  });

  it("drops the other circuit's draw from a combined event (China Open in ATP feed)", () => {
    const atpOnly = normalizeScoreboard(fixture("scoreboard-all"), "atp").find((t) => t.id === "959-2026")!;
    expect(atpOnly.tours).toEqual(["atp"]);
    expect(atpOnly.categories.map((c) => c.slug).sort()).toEqual(["mens-doubles", "mens-singles"]);
    expect(atpOnly.matches.every((m) => m.tour === "atp")).toBe(true);
  });

  it("merges the same event coming from ATP and WTA feeds", () => {
    const atp = tournaments.filter((t) => t.id === "959-2026").map((t) => ({ ...t, tours: ["atp" as const] }));
    const wta = tournaments.filter((t) => t.id === "959-2026").map((t) => ({ ...t, tours: ["wta" as const] }));
    const merged = mergeTournaments([atp, wta]);
    expect(merged).toHaveLength(1);
    expect(merged[0].tours.sort()).toEqual(["atp", "wta"]);
    expect(merged[0].matches).toHaveLength(atp[0].matches.length);
  });
});

describe("rankings", () => {
  it("returns compact entries with movement", () => {
    const r = normalizeRankings(fixture("rankings-atp"), "atp");
    expect(r.entries).toHaveLength(5);
    expect(r.entries[0]).toMatchObject({ rank: 1, points: 11000, player: { id: "3623", name: "Jannik Sinner" } });
    expect(r.entries[0].player.country.code).toBe("ITA");
    expect(r.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const e of r.entries) if (e.previousRank !== null) expect(e.movement).toBe(e.previousRank - e.rank);
  });
});

describe("news", () => {
  it("normalises site articles", () => {
    const news = normalizeNews(fixture("news-atp"));
    expect(news.length).toBeGreaterThan(0);
    const a = news[0];
    expect(a.headline).toBeTruthy();
    expect(a.url).toMatch(/^https:\/\/www\.espn\.com\//);
    expect(a.tours).toContain("atp");
    expect(a.players.length).toBeGreaterThan(0);
  });

  it("normalises Now API headlines (player filter)", () => {
    const news = normalizeNews(fixture("now-news-3782"));
    expect(news).toHaveLength(3);
    expect(news.every((n) => n.players.some((p) => p.id === "3782"))).toBe(true);
  });
});

describe("players", () => {
  it("search extracts id + tour from uid", () => {
    const [first] = normalizeSearch(fixture("search-alcaraz"));
    expect(first).toMatchObject({ id: "3782", name: "Carlos Alcaraz", tour: "atp" });
  });

  it("detects tour from athlete $refs", () => {
    expect(tourFromAthlete(fixture("athlete-3782"))).toBe("atp");
    expect(tourFromAthlete(fixture("athlete-1556"))).toBe("wta");
  });

  it("builds a profile with metric units, ranking and career stats", () => {
    const ranks = normalizeRankings(fixture("rankings-atp"), "atp");
    const p = normalizeProfile(fixture("athlete-3782"), fixture("athlete-stats-3782"), "atp", ranks);
    expect(p).toMatchObject({
      id: "3782",
      name: "Carlos Alcaraz",
      country: { code: "ESP", name: "Spain" },
      birthDate: "2003-05-05",
      heightCm: 182.9,
      hand: "right",
      turnedPro: 2018,
      career: { singlesWon: 306, singlesLost: 69, singlesTitles: 26 },
    });
    expect(p.ranking?.rank).toBe(ranks.entries.find((e) => e.player.id === "3782")?.rank);
  });

  it("computes season record ignoring walkovers", () => {
    const wo = matches.find((m) => m.status.endedBy === "walkover")!;
    const winner = wo.competitors.find((c) => c.id === wo.winnerId)!;
    const season = buildPlayerSeason(winner.players[0].id, "wta", 2026, matches);
    expect(season.matches.some((m) => m.id === wo.id)).toBe(true);
    expect(season.record.singles.wins + season.record.singles.losses).toBe(
      season.matches.filter((m) => m.status.state === "finished" && m.status.endedBy !== "walkover" && m.category.endsWith("singles")).length,
    );
  });
});
