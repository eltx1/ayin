import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export const databaseBaseline = {
  orm: "prisma",
  provider: "postgresql",
} as const;

export type DatabaseBaseline = typeof databaseBaseline;

const localDatabaseUrl = "postgresql://ayin:ayin@127.0.0.1:5432/ayin?schema=public";

export interface DatabasePoolSettings {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
  applicationName: string;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

export function resolveDatabasePoolSettings(
  environment: NodeJS.ProcessEnv = process.env,
): DatabasePoolSettings {
  const max = boundedInteger(environment.DATABASE_POOL_MAX, 10, 1, 50);
  const min = Math.min(boundedInteger(environment.DATABASE_POOL_MIN, 0, 0, 20), max);
  const serviceName = environment.AYIN_SERVICE_NAME?.trim() || "ayin";
  return {
    max,
    min,
    idleTimeoutMillis: boundedInteger(
      environment.DATABASE_POOL_IDLE_TIMEOUT_MS,
      10_000,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: boundedInteger(
      environment.DATABASE_POOL_CONNECT_TIMEOUT_MS,
      5_000,
      500,
      60_000,
    ),
    statementTimeoutMillis: boundedInteger(
      environment.DATABASE_STATEMENT_TIMEOUT_MS,
      0,
      0,
      300_000,
    ),
    applicationName: serviceName.slice(0, 63),
  };
}

export function createPrismaClient(
  connectionString = process.env.DATABASE_URL ?? localDatabaseUrl,
): PrismaClient {
  const settings = resolveDatabasePoolSettings();
  const poolConfig: PoolConfig = {
    connectionString,
    max: settings.max,
    min: settings.min,
    idleTimeoutMillis: settings.idleTimeoutMillis,
    connectionTimeoutMillis: settings.connectionTimeoutMillis,
    keepAlive: true,
    application_name: settings.applicationName,
    ...(settings.statementTimeoutMillis > 0
      ? { statement_timeout: settings.statementTimeoutMillis }
      : {}),
  };
  const pool = new Pool(poolConfig);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}
