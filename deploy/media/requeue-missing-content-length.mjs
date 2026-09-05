#!/usr/bin/env node

import { createPrismaClient } from "../../packages/db/dist/index.js";

const ADVISORY_LOCK = 86192030;

function requireProductionDatabase() {
  if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production") {
    throw new Error("media recovery refuses to run outside production");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for media recovery");

  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/ayin"
  ) {
    throw new Error("media recovery refuses a database outside the local AYIN production database");
  }

  return databaseUrl;
}

async function main() {
  const databaseUrl = requireProductionDatabase();
  const prisma = createPrismaClient(databaseUrl);

  try {
    const recovered = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1)", ADVISORY_LOCK);
      const now = new Date();
      return tx.mediaProcessingJob.updateMany({
        where: {
          status: "FAILED",
          finalAssetId: null,
          errorCode: "R2_PROCESSING_FAILED",
          errorMessage: { contains: "MissingContentLength" },
        },
        data: {
          status: "QUEUED",
          stage: "REPAIR_RETRY_QUEUED",
          progressPercent: 0,
          attempt: 0,
          queuedAt: now,
          startedAt: null,
          completedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
    });

    console.log(`Media recovery requeued ${recovered.count} MissingContentLength job(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `error: media recovery failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
