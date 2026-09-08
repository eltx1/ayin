import "reflect-metadata";

import { parseEnvironment } from "@ayin/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { z } from "zod";

import { AppModule } from "./app.module.js";
import { registerObservabilityHooks } from "./observability/observability-fastify.js";
import { ObservabilityService } from "./observability/observability.service.js";
import { releaseSha, StructuredLoggerService } from "./observability/structured-logger.service.js";
import {
  applyApiSecurityHeaders,
  isAllowedCookieMutationOrigin,
} from "./security/request-security.js";

const payoutEncryptionKeySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Buffer.from(value, "base64").length === 32, {
    message: "PAYOUT_DATA_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.",
  });

const apiEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  CORS_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  PAYOUT_DATA_ENCRYPTION_KEY: payoutEncryptionKeySchema,
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: "127.0.0.1",
      bodyLimit: 1024 * 1024,
    }),
    { bufferLogs: true },
  );

  const logger = app.get(StructuredLoggerService);
  const observability = app.get(ObservabilityService);
  app.useLogger(logger);
  app.flushLogs();
  app.enableShutdownHooks();
  app.enableCors({
    allowedHeaders: [
      "authorization",
      "content-type",
      "x-ayin-auth-transport",
      "x-request-id",
      "x-correlation-id",
    ],
    exposedHeaders: ["x-request-id", "x-correlation-id", "x-ayin-release"],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin: environment.CORS_ORIGIN,
  });

  const fastify = app.getHttpAdapter().getInstance();
  registerObservabilityHooks(fastify, observability, logger);
  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("x-ayin-release", releaseSha());
    applyApiSecurityHeaders(reply, request);
    if (!isAllowedCookieMutationOrigin(request, environment.CORS_ORIGIN)) {
      await reply.code(403).send({
        error: {
          code: "CSRF_ORIGIN_REJECTED",
          message: "This authenticated mutation did not come from the configured AYIN web origin.",
        },
      });
    }
  });

  await app.listen({ host: environment.API_HOST, port: environment.PORT });
  logger.event("info", "server.started", {
    host: environment.API_HOST,
    port: environment.PORT,
    releaseSha: releaseSha(),
    telemetry: observability.adapterStatus(),
  });
}

void bootstrap();
