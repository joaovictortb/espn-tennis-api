import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));

type Route = [RegExp, number, unknown];

/** Returns a `fetch` replacement that answers by matching the requested URL. */
export function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const fn = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response(JSON.stringify({ code: 404 }), { status: 404 });
    const [, status, body] = hit;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return Object.assign(fn, { calls });
}
