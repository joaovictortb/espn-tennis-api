import { config } from "../config.js";
import { AppError, UpstreamError, UpstreamTimeoutError } from "./errors.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; espn-tennis-api/2.0)",
      },
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new UpstreamTimeoutError(url);
    }
    throw new AppError(502, "UPSTREAM_ERROR", `Network error calling ESPN: ${(err as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) throw new UpstreamError(res.status, url, text.slice(0, 200) || res.statusText);

  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError(res.status, url, "response is not valid JSON");
  }
}

/** GET JSON from ESPN with timeout and retry (network errors, 429 and 5xx only). */
export async function fetchJson<T = unknown>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.upstreamRetries; attempt++) {
    try {
      return (await fetchOnce(url)) as T;
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof UpstreamTimeoutError ||
        (err instanceof UpstreamError ? RETRYABLE_STATUS.has(err.upstreamStatus) : err instanceof AppError);
      if (!retryable || attempt === config.upstreamRetries) break;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}
