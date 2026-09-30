import Fastify, { type FastifyServerOptions } from "fastify";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import { AppError } from "./lib/errors.js";
import { v1Routes } from "./routes/v1.js";
import { cache } from "./services/tennis.js";

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: { level: config.logLevel },
    ajv: { customOptions: { coerceTypes: true, useDefaults: true, removeAdditional: true } },
    ...opts,
  });

  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : true, methods: ["GET"] });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "ESPN Tennis API",
        version: "2.0.0",
        description:
          "Normalised proxy over undocumented ESPN tennis endpoints. Every /v1 response is `{ data, meta }`. Errors are `{ error: { code, message } }`.",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.warn({ err }, "upstream failure");
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation || e.statusCode === 400) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: e.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found. See /docs` } }),
  );

  app.get("/", { schema: { hide: true } }, async () => ({
    name: "ESPN Tennis API",
    version: "2.0.0",
    docs: "/docs",
    warning: "Uses undocumented ESPN endpoints. Schemas may change; public access does not imply redistribution rights.",
  }));

  app.get("/health", { schema: { tags: ["system"] } }, async () => ({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    cacheEntries: cache.size,
    heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    at: new Date().toISOString(),
  }));

  await app.register(v1Routes, { prefix: "/v1" });
  return app;
}
