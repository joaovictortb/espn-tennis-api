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
  /**
   * Comma separated list of allowed CORS origins. Empty = only the 0-40 web
   * app (production domain, Vercel previews, localhost). Native apps and
   * server-to-server calls don't send Origin, so they are not affected.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Requests per minute per client IP (SEC-14). */
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 300),
  /** `/v1/raw` passthrough. On by default, off when NODE_ENV=production unless ENABLE_RAW=true. */
  /**
   * Optional: persist resolved player photos via RPCs pro_player_photos_list /
   * pro_player_photo_upsert. Public anon key + a write-only secret — never the
   * service role (SEC-14).
   */
  supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/$/, ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  photosWriterKey: process.env.PHOTOS_WRITER_KEY ?? "",
  enableRaw: process.env.ENABLE_RAW ? process.env.ENABLE_RAW === "true" : process.env.NODE_ENV !== "production",
} as const;
