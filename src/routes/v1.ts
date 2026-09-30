import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import type { MatchState, Tour, TourParam } from "../domain/types.js";
import { ALLOWED_RAW_HOSTS } from "../espn/client.js";
import { isIsoDate, isValidTimezone, todayIn } from "../lib/dates.js";
import { badRequest } from "../lib/errors.js";
import { toSummary } from "../normalize/matches.js";
import * as svc from "../services/tennis.js";

const MATCH_STATES: MatchState[] = ["scheduled", "live", "finished", "canceled", "postponed", "suspended"];

// ---------------------------------------------------------------- shared schemas

const tourAll = { type: "string", enum: ["atp", "wta", "all"], default: "all", description: "Circuit filter" } as const;
const tourOne = { type: "string", enum: ["atp", "wta"], description: "Circuit" } as const;
const statusList = {
  type: "string",
  description: `Comma separated: ${MATCH_STATES.join(",")}`,
  pattern: `^(${MATCH_STATES.join("|")})(,(${MATCH_STATES.join("|")}))*$`,
} as const;
const category = {
  type: "string",
  description: "mens-singles | womens-singles | mens-doubles | womens-doubles | mixed-doubles",
} as const;
const countryCode = {
  type: "string",
  pattern: "^[A-Za-z]{3}$",
  description: "ESPN country code, IOC-style (BRA, ARG, GER, SUI...)",
} as const;
const idParam = (pattern: string) =>
  ({ type: "object", required: ["id"], properties: { id: { type: "string", pattern } } }) as const;

type Envelope<T> = { data: T; meta: Record<string, unknown> };

function send<T>(reply: FastifyReply, result: svc.Result<T>, maxAgeSec: number, meta: Record<string, unknown> = {}) {
  reply.header("cache-control", `public, max-age=${maxAgeSec}`);
  const count = Array.isArray(result.value) ? { count: result.value.length } : {};
  return { data: result.value, meta: { ...meta, ...count, cached: result.cached, generatedAt: new Date().toISOString() } } satisfies Envelope<T>;
}

const parseStatus = (s?: string) => (s ? (s.split(",") as MatchState[]) : undefined);

function resolveTz(tz?: string) {
  const value = tz ?? config.defaultTimezone;
  if (!isValidTimezone(value)) throw badRequest(`Invalid timezone "${value}". Use an IANA name like America/Sao_Paulo`);
  return value;
}

// ---------------------------------------------------------------- routes

export async function v1Routes(app: FastifyInstance) {
  // ------------------------------------------------ matches
  app.get<{
    Querystring: { tour: TourParam; date?: string; tz?: string; status?: string; category?: string; tournamentId?: string; playerId?: string; country?: string };
  }>(
    "/matches",
    {
      schema: {
        tags: ["matches"],
        summary: "Matches of one day (default: today in `tz`)",
        querystring: {
          type: "object",
          properties: {
            tour: tourAll,
            date: { type: "string", description: "YYYY-MM-DD (default today in tz)" },
            tz: { type: "string", description: `IANA timezone used to split days (default ${config.defaultTimezone})` },
            status: statusList,
            category,
            tournamentId: { type: "string", description: 'Event id, e.g. "959-2026"' },
            playerId: { type: "string", pattern: "^\\d+$" },
            country: countryCode,
          },
        },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const tz = resolveTz(q.tz);
      const date = q.date ?? todayIn(tz);
      if (!isIsoDate(date)) throw badRequest("date must be YYYY-MM-DD");
      const result = await svc.matchesOnDay(q.tour, date, tz);
      const filtered = svc.filterMatches(result.value, { ...q, status: parseStatus(q.status) });
      return send(reply, { value: filtered, cached: result.cached }, 30, { tour: q.tour, date, tz });
    },
  );

  app.get<{ Querystring: { tour: TourParam; category?: string; country?: string } }>(
    "/matches/live",
    {
      schema: {
        tags: ["matches"],
        summary: "Matches in progress right now",
        querystring: { type: "object", properties: { tour: tourAll, category, country: countryCode } },
      },
    },
    async (req, reply) => {
      const result = await svc.liveMatches(req.query.tour);
      const value = svc.filterMatches(result.value, req.query);
      return send(reply, { value, cached: result.cached }, 15, { tour: req.query.tour });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { tour: TourParam } }>(
    "/matches/:id",
    {
      schema: {
        tags: ["matches"],
        summary: "One match (searches running tournaments, then current season)",
        params: idParam("^\\d+$"),
        querystring: { type: "object", properties: { tour: tourAll } },
      },
    },
    async (req, reply) => send(reply, await svc.findMatch(req.params.id, req.query.tour), 15),
  );

  // ------------------------------------------------ tournaments
  app.get<{ Querystring: { tour: TourParam; year?: number; state?: string; grandSlam?: boolean } }>(
    "/tournaments",
    {
      schema: {
        tags: ["tournaments"],
        summary: "Season calendar (no matches)",
        querystring: {
          type: "object",
          properties: {
            tour: tourAll,
            year: { type: "integer", minimum: 2000, maximum: 2100, description: "Default: current year" },
            state: { type: "string", enum: ["upcoming", "in_progress", "completed"] },
            grandSlam: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const { tour, state, grandSlam } = req.query;
      const year = req.query.year ?? new Date().getUTCFullYear();
      const result = await svc.season(tour, year);
      const value = result.value
        .filter((t) => (!state || t.state === state) && (grandSlam === undefined || t.isGrandSlam === grandSlam))
        .map(toSummary);
      return send(reply, { value, cached: result.cached }, 600, { tour, year });
    },
  );

  app.get<{ Querystring: { tour: TourParam } }>(
    "/tournaments/current",
    {
      schema: {
        tags: ["tournaments"],
        summary: "Tournaments running now (no matches)",
        querystring: { type: "object", properties: { tour: tourAll } },
      },
    },
    async (req, reply) => {
      const result = await svc.currentTournaments(req.query.tour);
      return send(reply, { value: result.value.map(toSummary), cached: result.cached }, 60, { tour: req.query.tour });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { tour: TourParam; category?: string; round?: string; status?: string } }>(
    "/tournaments/:id",
    {
      schema: {
        tags: ["tournaments"],
        summary: "Tournament with its full draw (all matches)",
        params: idParam("^\\d+-\\d{4}$"),
        querystring: {
          type: "object",
          properties: { tour: tourAll, category, round: { type: "string", description: 'Round name, e.g. "Final", "Round 1"' }, status: statusList },
        },
      },
    },
    async (req, reply) => {
      const { tour, category: cat, round, status } = req.query;
      const result = await svc.findTournament(req.params.id, tour);
      const matches = svc
        .filterMatches(result.value.matches, { category: cat, status: parseStatus(status) })
        .filter((m) => !round || m.round.name === round);
      return send(reply, { value: { ...result.value, matches }, cached: result.cached }, 30, { tour });
    },
  );

  // ------------------------------------------------ rankings
  app.get<{ Querystring: { tour: Tour; limit: number; country?: string } }>(
    "/rankings",
    {
      schema: {
        tags: ["rankings"],
        summary: "Official singles ranking (ESPN publishes top 150)",
        querystring: {
          type: "object",
          properties: {
            tour: { ...tourOne, default: "atp" },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            country: countryCode,
          },
        },
      },
    },
    async (req, reply) => {
      const result = await svc.rankings(req.query.tour);
      const country = req.query.country?.toUpperCase();
      const entries = result.value.entries.filter((e) => !country || e.player.country.code === country);
      const value = { ...result.value, entries: entries.slice(0, req.query.limit) };
      return send(reply, { value, cached: result.cached }, 1800);
    },
  );

  // ------------------------------------------------ news
  app.get<{ Querystring: { tour: TourParam; limit: number; playerId?: string } }>(
    "/news",
    {
      schema: {
        tags: ["news"],
        summary: "ESPN tennis news (optionally about one player)",
        querystring: {
          type: "object",
          properties: {
            tour: tourAll,
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            playerId: { type: "string", pattern: "^\\d+$" },
          },
        },
      },
    },
    async (req, reply) => send(reply, await svc.news(req.query), 300, { tour: req.query.tour }),
  );

  app.get<{ Params: { id: string } }>(
    "/news/:id",
    {
      schema: {
        tags: ["news"],
        summary: "One article with the full text (paragraphs) and all images",
        params: idParam("^\\d+$"),
      },
    },
    async (req, reply) => send(reply, await svc.newsStory(req.params.id), 3600),
  );

  // ------------------------------------------------ players
  app.get<{ Querystring: { q: string; limit: number } }>(
    "/players/search",
    {
      schema: {
        tags: ["players"],
        summary: "Search players by name",
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 2, maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 25, default: 10 } },
        },
      },
    },
    async (req, reply) => send(reply, await svc.searchPlayers(req.query.q.trim(), req.query.limit), 600),
  );

  app.get<{ Params: { id: string }; Querystring: { tour?: Tour } }>(
    "/players/:id",
    {
      schema: {
        tags: ["players"],
        summary: "Player profile + current ranking + career totals",
        params: idParam("^\\d+$"),
        querystring: { type: "object", properties: { tour: { ...tourOne, description: "Optional, auto-detected" } } },
      },
    },
    async (req, reply) => send(reply, await svc.playerProfile(req.params.id, req.query.tour), 3600),
  );

  app.get<{ Params: { id: string }; Querystring: { tour?: Tour; year?: number; status?: string; limit: number } }>(
    "/players/:id/matches",
    {
      schema: {
        tags: ["players"],
        summary: "Player matches in a season + W/L record (most recent first)",
        params: idParam("^\\d+$"),
        querystring: {
          type: "object",
          properties: {
            tour: { ...tourOne, description: "Optional, auto-detected" },
            year: { type: "integer", minimum: 2000, maximum: 2100 },
            status: statusList,
            limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (req, reply) => {
      const tour = await svc.resolvePlayerTour(req.params.id, req.query.tour);
      const year = req.query.year ?? new Date().getUTCFullYear();
      const result = await svc.playerSeason(req.params.id, tour, year);
      const matches = svc.filterMatches(result.value.matches, { status: parseStatus(req.query.status) }).slice(0, req.query.limit);
      return send(reply, { value: { ...result.value, matches }, cached: result.cached }, 300);
    },
  );

  // ------------------------------------------------ raw passthrough (exploration / debugging)
  if (config.enableRaw) {
    app.get<{ Querystring: { url: string } }>(
      "/raw",
      {
        schema: {
          tags: ["debug"],
          summary: "Raw ESPN JSON for a tennis URL (allow-listed hosts only)",
          querystring: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
        },
      },
      async (req, reply) => {
        let target: URL;
        try {
          target = new URL(req.query.url);
        } catch {
          throw badRequest("url must be an absolute URL");
        }
        if (target.protocol !== "https:" && target.protocol !== "http:") throw badRequest("url must be http(s)");
        if (!ALLOWED_RAW_HOSTS.has(target.hostname)) throw badRequest(`host not allowed. Allowed: ${[...ALLOWED_RAW_HOSTS].join(", ")}`);
        if (!/tennis|search|news/.test(target.pathname + target.search)) throw badRequest("only tennis resources are allowed");
        target.protocol = "https:";
        return send(reply, await svc.raw(target.toString()), 60, { url: target.toString() });
      },
    );
  }
}
