import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export const databaseBaseline = {
  orm: "prisma",
  provider: "postgresql",
} as const;

export type DatabaseBaseline = typeof databaseBaseline;

const localDatabaseUrl = "postgresql://ayin:ayin@127.0.0.1:5432/ayin?schema=public";

export function createPrismaClient(
  connectionString = process.env.DATABASE_URL ?? localDatabaseUrl,
): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
