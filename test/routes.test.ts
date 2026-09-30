import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { cache } from "../src/services/tennis.js";
import { fakeFetch, fixture } from "./helpers.js";

let app: FastifyInstance;
let fetchMock: ReturnType<typeof fakeFetch>;

const routes = () =>
  fakeFetch([
    [/\/tennis\/(all|atp|wta)\/scoreboard/, 200, fixture("scoreboard-all")],
    [/\/tennis\/atp\/rankings/, 200, fixture("rankings-atp")],
    [/\/tennis\/(all|atp|wta)\/news/, 200, fixture("news-atp")],
    [/now\.core\.api\.espn\.com.*athletes=3782/, 200, fixture("now-news-3782")],
    [/search\/v2/, 200, fixture("search-alcaraz")],
    [/\/tennis\/athletes\/3782(\?|$)/, 200, fixture("athlete-3782")],
    [/\/tennis\/athletes\/1556(\?|$)/, 200, fixture("athlete-1556")],
    [/\/athletes\/3782\/statistics/, 200, fixture("athlete-stats-3782")],
    [/\/tennis\/athletes\/999(\?|$)/, 400, { error: { code: 400 } }],
    [/\/tennis\/wta\/rankings/, 500, { message: "boom" }],
  ]);

beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(() => app.close());
beforeEach(() => {
  cache.clear();
  fetchMock = routes();
  vi.stubGlobal("fetch", fetchMock);
});

const get = (url: string) => app.inject({ method: "GET", url });

describe("routes", () => {
  it("GET /health", async () => {
    const r = await get("/health");
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
  });

  it("GET /v1/matches/live returns only live matches with envelope", async () => {
    const r = await get("/v1/matches/live?tour=all");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.meta).toMatchObject({ tour: "all", count: 5, cached: false });
    expect(body.data.every((m: any) => m.status.state === "live")).toBe(true);
    expect(r.headers["cache-control"]).toBe("public, max-age=15");
  });

  it("caches upstream calls", async () => {
    await get("/v1/matches/live");
    const second = await get("/v1/matches/live");
    expect(second.json().meta.cached).toBe(true);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("GET /v1/matches filters by day in timezone + status", async () => {
    const r = await get("/v1/matches?date=2026-09-30&tz=America/Sao_Paulo&status=live,finished");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.meta.date).toBe("2026-09-30");
    for (const m of body.data) {
      expect(["live", "finished"]).toContain(m.status.state);
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(m.startTime));
      expect(local).toBe("2026-09-30");
    }
    // D-1, D, D+1
    expect(fetchMock.calls.filter((u) => u.includes("dates=")).map((u) => u.split("dates=")[1])).toEqual([
      "20260929",
      "20260930",
      "20261001",
    ]);
  });

  it("GET /v1/matches/:id", async () => {
    const r = await get("/v1/matches/186244");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe("186244");
  });

  it("GET /v1/tournaments/:id with filters", async () => {
    const r = await get("/v1/tournaments/959-2026?category=mens-singles");
    expect(r.statusCode).toBe(200);
    const t = r.json().data;
    expect(t.name).toBe("China Open");
    expect(t.matches.every((m: any) => m.category === "mens-singles")).toBe(true);
  });

  it("GET /v1/tournaments/current has no matches", async () => {
    const r = await get("/v1/tournaments/current");
    expect(r.json().data[0].matches).toBeUndefined();
  });

  it("GET /v1/rankings", async () => {
    const r = await get("/v1/rankings?tour=atp&limit=3");
    expect(r.json().data.entries).toHaveLength(3);
  });

  it("filters rankings and matches by country", async () => {
    const r = await get("/v1/rankings?tour=atp&country=ita");
    expect(r.json().data.entries.every((e: any) => e.player.country.code === "ITA")).toBe(true);
    expect(r.json().data.entries.length).toBeGreaterThan(0);

    const live = await get("/v1/matches/live?country=SRB");
    expect(live.statusCode).toBe(200);
    for (const m of live.json().data) expect(m.competitors.some((c: any) => c.players.some((p: any) => p.country.code === "SRB"))).toBe(true);
    expect((await get("/v1/rankings?country=BRASIL")).statusCode).toBe(400);
  });

  it("GET /v1/news?playerId uses the Now API", async () => {
    const r = await get("/v1/news?playerId=3782&limit=2");
    expect(r.json().data).toHaveLength(2);
    expect(fetchMock.calls[0]).toContain("now.core.api.espn.com");
  });

  it("GET /v1/players/search", async () => {
    const r = await get("/v1/players/search?q=alcaraz&limit=3");
    expect(r.json().data[0]).toMatchObject({ id: "3782", tour: "atp" });
  });

  it("GET /v1/players/:id auto-detects tour", async () => {
    const r = await get("/v1/players/3782");
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ id: "3782", tour: "atp", career: { singlesWon: 306 } });
  });

  it("maps ESPN 400 for unknown athlete to 404", async () => {
    const r = await get("/v1/players/999");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: { code: "NOT_FOUND", message: "Player 999 not found" } });
  });

  it("maps ESPN 5xx to 502 after retrying", async () => {
    const r = await get("/v1/rankings?tour=wta");
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe("UPSTREAM_ERROR");
    expect(fetchMock.calls.filter((u) => u.includes("wta/rankings"))).toHaveLength(2);
  });

  it("validates input", async () => {
    expect((await get("/v1/matches?date=30-09-2026")).statusCode).toBe(400);
    expect((await get("/v1/matches?status=playing")).statusCode).toBe(400);
    expect((await get("/v1/matches?tz=Mars/Base")).statusCode).toBe(400);
    expect((await get("/v1/tournaments/abc")).statusCode).toBe(400);
    expect((await get("/v1/players/search?q=a")).statusCode).toBe(400);
  });

  it("raw passthrough only allows ESPN hosts", async () => {
    expect((await get("/v1/raw?url=http://169.254.169.254/latest")).statusCode).toBe(400);
    expect((await get("/v1/raw?url=https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard")).statusCode).toBe(400);
    const ok = await get(`/v1/raw?url=${encodeURIComponent("https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings")}`);
    expect(ok.statusCode).toBe(200);
  });

  it("unknown route -> 404 json", async () => {
    const r = await get("/v1/nope");
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });
});
