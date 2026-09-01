import "reflect-metadata";

import { parseEnvironment } from "@ayin/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { z } from "zod";

import { AppModule } from "./app.module.js";
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
      // AYIN is intentionally reachable only through the local CloudPanel/Nginx reverse proxy.
      // Trust exactly that hop so request.ip reflects the real direct-origin client for auth limits.
      // When Cloudflare proxying is enabled, normalize Cloudflare client IPs in Nginx rather than
      // broadening this trust boundary to arbitrary forwarding headers.
      trustProxy: "127.0.0.1",
      // Media uploads are direct-to-R2. Keep ordinary API bodies deliberately small.
      bodyLimit: 1024 * 1024,
    }),
  );

  app.enableShutdownHooks();
  app.enableCors({
    allowedHeaders: ["authorization", "content-type", "x-ayin-auth-transport"],
    credentials: true,
    origin: environment.CORS_ORIGIN,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (request, reply) => {
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
}

void bootstrap();
