import "reflect-metadata";

import { parseEnvironment } from "@ayin/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { z } from "zod";

import { AppModule } from "./app.module.js";

const apiEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  CORS_ORIGIN: z.url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.enableCors({ origin: environment.CORS_ORIGIN });

  await app.listen({ host: environment.API_HOST, port: environment.PORT });
}

void bootstrap();
