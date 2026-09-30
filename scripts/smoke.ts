/**
 * Smoke test against a RUNNING server that talks to the real ESPN.
 * Detects ESPN schema changes early (empty lists, missing fields).
 *
 *   npm run dev            # in one terminal
 *   npm run smoke          # in another (BASE_URL=http://localhost:3333 by default)
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3333";

type Check = { path: string; expect: (body: any) => string | null };

const nonEmpty = (label: string, arr: unknown) => (Array.isArray(arr) && arr.length ? null : `${label} is empty`);

const checks: Check[] = [
  { path: "/health", expect: (b) => (b.ok ? null : "not ok") },
  { path: "/v1/matches/live", expect: (b) => (Array.isArray(b.data) ? null : "data is not an array") },
  {
    path: "/v1/matches",
    expect: (b) => (Array.isArray(b.data) ? null : "data is not an array"),
  },
  {
    path: "/v1/tournaments/current",
    expect: (b) => nonEmpty("current tournaments", b.data),
  },
  {
    path: "/v1/tournaments?tour=atp",
    expect: (b) => nonEmpty("season", b.data) ?? (b.data.some((t: any) => t.isGrandSlam) ? null : "no grand slam in season"),
  },
  {
    path: "/v1/rankings?tour=atp&limit=10",
    expect: (b) => nonEmpty("atp ranking", b.data.entries) ?? (b.data.entries[0].rank === 1 ? null : "first rank is not 1"),
  },
  { path: "/v1/rankings?tour=wta&limit=10", expect: (b) => nonEmpty("wta ranking", b.data.entries) },
  { path: "/v1/news?limit=5", expect: (b) => nonEmpty("news", b.data) },
  { path: "/v1/news?playerId=3782&limit=5", expect: (b) => nonEmpty("player news", b.data) },
  {
    path: "/v1/players/search?q=sinner",
    expect: (b) => (b.data.some((p: any) => p.id === "3623") ? null : "Sinner (3623) not found"),
  },
  {
    path: "/v1/players/3623",
    expect: (b) => (b.data.name === "Jannik Sinner" && b.data.career.singlesWon > 0 ? null : "bad profile"),
  },
  {
    path: "/v1/players/3623/matches?limit=5",
    expect: (b) => nonEmpty("Sinner season matches", b.data.matches),
  },
];

let failed = 0;
for (const c of checks) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + c.path);
    const body: any = await res.json();
    const problem = res.ok ? c.expect(body) : `HTTP ${res.status} ${JSON.stringify(body.error)}`;
    const ms = Date.now() - started;
    if (problem) failed++;
    const count = body?.meta?.count !== undefined ? ` count=${body.meta.count}` : "";
    console.log(`${problem ? "FAIL" : " ok "} ${c.path.padEnd(42)} ${String(ms).padStart(5)}ms${count}${problem ? `  -> ${problem}` : ""}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${c.path} -> ${(err as Error).message}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
