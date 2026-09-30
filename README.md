# ESPN Tennis API

Node.js + TypeScript + Fastify. Normalised, cached proxy over undocumented ESPN tennis endpoints (ATP + WTA).

- Stable response contract: `src/domain/types.ts`
- OpenAPI / Swagger UI: `http://localhost:3333/docs`
- Integration guide for the 0-40 app: [`docs/INTEGRACAO-040.md`](docs/INTEGRACAO-040.md) (+ kickoff prompt [`docs/PROMPT-040.md`](docs/PROMPT-040.md))
- Insomnia collection: [`insomnia/espn-tennis-api.insomnia.json`](insomnia/espn-tennis-api.insomnia.json) (Import → File)

## Run

```bash
npm install
cp .env.example .env
npm run dev          # watch mode, http://localhost:3333
npm test             # unit + route tests (ESPN mocked with fixtures)
npm run smoke        # hits the running server -> real ESPN, detects schema changes
npm run build && npm run start:prod
```

## Endpoints

All `/v1` responses are `{ data, meta }`. Errors are `{ error: { code, message } }` with 400 / 404 / 502 / 504.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | uptime, cache size, heap |
| GET | `/v1/matches?date=&tz=&tour=&status=&category=&tournamentId=&playerId=&country=` | matches of one day (default today in `tz`) |
| GET | `/v1/matches/live?tour=&category=&country=` | in progress now |
| GET | `/v1/matches/:id` | one match |
| GET | `/v1/tournaments?tour=&year=&state=&grandSlam=` | season calendar |
| GET | `/v1/tournaments/current?tour=` | running now |
| GET | `/v1/tournaments/:id?category=&round=&status=` | full draw, id like `959-2026` |
| GET | `/v1/rankings?tour=atp\|wta&limit=&country=` | top 150 singles |
| GET | `/v1/news?tour=&limit=&playerId=` | ESPN news |
| GET | `/v1/players/search?q=` | by name |
| GET | `/v1/players/:id?tour=` | profile + ranking + career |
| GET | `/v1/players/:id/matches?year=&status=&limit=` | season matches + W/L |
| GET | `/v1/raw?url=` | raw ESPN JSON (dev only, allow-listed hosts) |

## Architecture

```
src/
  config.ts            env
  lib/                 http (timeout+retry), TTL cache (dedupe + stale-if-error), dates, errors
  espn/client.ts       thin uncached ESPN fetchers + raw typings
  normalize/           ESPN JSON -> domain types (pure functions, unit tested)
  services/tennis.ts   orchestration + caching of normalised data
  routes/v1.ts         HTTP layer: validation (JSON schema), envelope, cache headers
  app.ts / server.ts   Fastify setup / bootstrap
test/                  vitest, fixtures captured from real ESPN responses
scripts/smoke.ts       live check against ESPN
```

## ESPN quirks handled

- Tournament `status` says "post" while matches are still live → state is derived from matches.
- `scoreboard` returns whole draws, not the matches of a day → filtered by start time in the requested timezone.
- ESPN date ranges (`dates=A-B`) return unrelated events → only single days / whole years are used.
- `summary?event=` does not work for tennis (always 400) → not used.
- Core API returns only `$ref` links → used only for athlete profile/stats.
- Unknown athlete ids return 400 → mapped to 404.
- Same event (e.g. China Open) appears in ATP and WTA feeds → merged.

## Important

These ESPN endpoints are undocumented/internal. Availability and schemas can change without notice.
No API key being required does not imply a right to commercially redistribute ESPN data. Check applicable terms before production use.
