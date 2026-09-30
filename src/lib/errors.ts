export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string) => new AppError(400, "BAD_REQUEST", message);
export const notFound = (message: string) => new AppError(404, "NOT_FOUND", message);

/** Error returned by ESPN (HTTP status kept so 404 can be forwarded as 404). */
export class UpstreamError extends AppError {
  constructor(
    readonly upstreamStatus: number,
    readonly url: string,
    detail: string,
  ) {
    super(
      upstreamStatus === 404 ? 404 : 502,
      upstreamStatus === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR",
      `ESPN responded ${upstreamStatus}: ${detail}`,
    );
    this.name = "UpstreamError";
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(readonly url: string) {
    super(504, "UPSTREAM_TIMEOUT", "ESPN did not respond in time");
    this.name = "UpstreamTimeoutError";
  }
}
