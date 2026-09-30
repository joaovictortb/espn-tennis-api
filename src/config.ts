const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3333),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
  /** Timeout for each request to ESPN. */
  upstreamTimeoutMs: num(process.env.ESPN_TIMEOUT_MS, 12_000),
  /** Retries on network errors / 5xx (not on 4xx). */
  upstreamRetries: num(process.env.ESPN_RETRIES, 1),
  /** Max entries kept in the in-memory cache. */
  cacheMaxEntries: num(process.env.CACHE_MAX_ENTRIES, 500),
  /** Default timezone used to decide which calendar day a match belongs to. */
  defaultTimezone: process.env.DEFAULT_TZ ?? "America/Sao_Paulo",
  /** Comma separated list of allowed CORS origins. Empty = allow all. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** `/v1/raw` passthrough. On by default, off when NODE_ENV=production unless ENABLE_RAW=true. */
  /** Optional: persist resolved player photos (table pro_player_photos). */
  supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/$/, ""),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  enableRaw: process.env.ENABLE_RAW ? process.env.ENABLE_RAW === "true" : process.env.NODE_ENV !== "production",
} as const;
