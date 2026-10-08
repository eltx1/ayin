import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createPrismaClient } from "../src/index.ts";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";

function runPrisma(args, input) {
  return spawnSync(corepack, ["pnpm", "exec", "prisma", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    input,
  });
}

function expectSuccess(result) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("PostgreSQL migration bootstrap", () => {
  it("deploys and seeds a disposable clean database idempotently", () => {
    expectSuccess(runPrisma(["migrate", "deploy"]));
    expectSuccess(runPrisma(["migrate", "deploy"]));
    expectSuccess(runPrisma(["db", "seed"]));
    expectSuccess(runPrisma(["db", "seed"]));
  });

  it("tags pooled PostgreSQL connections with the AYIN service name", async () => {
    const previousServiceName = process.env.AYIN_SERVICE_NAME;
    process.env.AYIN_SERVICE_NAME = "ayin-task86-pool-test";
    const client = createPrismaClient(testDatabaseUrl);
    try {
      const rows = await client.$queryRawUnsafe(
        "SELECT current_setting('application_name') AS \"applicationName\"",
      );
      expect(rows[0]?.applicationName).toBe("ayin-task86-pool-test");
    } finally {
      await client.$disconnect().catch(() => undefined);
      if (previousServiceName === undefined) delete process.env.AYIN_SERVICE_NAME;
      else process.env.AYIN_SERVICE_NAME = previousServiceName;
    }
  });

  it("disconnects adapter-owned pools immediately instead of waiting for pool idle timeout", async () => {
    const previousIdleTimeout = process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = "300000";
    const client = createPrismaClient(testDatabaseUrl);
    let disconnected = false;
    try {
      await client.$queryRawUnsafe("SELECT 1");
      const startedAt = performance.now();
      await client.$disconnect();
      disconnected = true;
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    } finally {
      if (!disconnected) await client.$disconnect().catch(() => undefined);
      if (previousIdleTimeout === undefined) delete process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
      else process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = previousIdleTimeout;
    }
  });

  it("enforces important relational and value constraints", () => {
    const duplicateSetting = runPrisma(
      ["db", "execute", "--stdin"],
      `INSERT INTO "PlatformSetting" ("id", "namespace", "key", "valueType", "value", "createdAt", "updatedAt") VALUES ('10000000-0000-4000-8000-000000000001', 'CREATOR', 'uploadsPlaylistName', 'STRING', '"Other"'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
    expect(duplicateSetting.status).not.toBe(0);

    const orphanChannelSettings = runPrisma(
      ["db", "execute", "--stdin"],
      `INSERT INTO "ChannelSettings" ("id", "channelId", "createdAt", "updatedAt") VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000099', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
    expect(orphanChannelSettings.status).not.toBe(0);

    const invalidRollout = runPrisma(
      ["db", "execute", "--stdin"],
      `INSERT INTO "FeatureFlag" ("id", "key", "rolloutPercentage", "createdAt", "updatedAt") VALUES ('10000000-0000-4000-8000-000000000003', 'invalid-rollout', 101, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    );
    expect(invalidRollout.status).not.toBe(0);
  });
});

databaseDescribe("Populated finite-cleanup forward migration", () => {
  it("preserves V1 evidence and uncertainty without manufacturing V2 acknowledgement", async () => {
    const pool = new pg.Pool({ connectionString: testDatabaseUrl });
    const client = await pool.connect();
    const schema = `finite_migration_${randomUUID().replaceAll("-", "")}`;
    const migrationRoot = join(packageRoot, "prisma", "migrations");
    const migration = "20261008190000_finite_media_cleanup_v2";
    const sessionId = randomUUID(),
      channelId = randomUUID(),
      jobId = randomUUID();
    const operationIds = [randomUUID(), randomUUID()];
    const leaseToken = randomUUID();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      // Replay the actual historical SQL, not an approximation of the old schema.
      for (const entry of (await readdir(migrationRoot)).sort()) {
        if (entry >= migration || entry === "migration_lock.toml") continue;
        await client.query(await readFile(join(migrationRoot, entry, "migration.sql"), "utf8"));
      }
      await client.query(
        `INSERT INTO "MediaUploadSession"
        (id,"channelId",authority,mode,"objectKey","providerUploadId","sizeBytes","mimeType","partSizeBytes",
         "contentIdentityAlgorithm","contentIdentityDigest",state,"updatedAt","hardExpiresAt","grantsRevokedAt","cleanupRequestedAt")
        VALUES ($1,$2,'OWNER','MULTIPART','synthetic/v1/source.mp4','synthetic-v1-allocation',1024,'video/mp4',5242880,
          'AYIN_SHA256_CHUNKS_V1',NULL,'ABORTED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + interval '1 hour',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [sessionId, channelId],
      );
      // Two old dispatch records are legal historical evidence. The new one-dispatch
      // index must not reinterpret either as a truthful V2 provider acknowledgement.
      for (const id of operationIds)
        await client.query(
          `INSERT INTO "MediaUploadOperation"
        (id,"sessionId","requestId",kind,"requestDigest","expectedRevision",status,"updatedAt","dispatchStartedAt")
        VALUES ($1,$2,$3,'CREATE',$4,1,'UNKNOWN',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          [id, sessionId, randomUUID(), "a".repeat(64)],
        );
      await client.query(
        `INSERT INTO "PrivacyMediaDeletionJob"
        (id,kind,target,"operationKey",scope,"channelId","uploadSessionId","sessionRevision",status,"completedAt",
          "settlementProofReference","settlementVerifiedAt","settlementLeaseToken","updatedAt")
        VALUES ($1,'OBJECT','synthetic/v1/source.mp4','synthetic-v1-done','UPLOAD_SESSION',$2,$3,1,'DONE',CURRENT_TIMESTAMP,
          'synthetic:historical-v1-proof',CURRENT_TIMESTAMP,$4,CURRENT_TIMESTAMP)`,
        [jobId, channelId, sessionId, leaseToken],
      );
      const before = (
        await client.query('SELECT * FROM "PrivacyMediaDeletionJob" WHERE id=$1', [jobId])
      ).rows[0];
      await client.query(await readFile(join(migrationRoot, migration, "migration.sql"), "utf8"));
      const after = (
        await client.query('SELECT * FROM "PrivacyMediaDeletionJob" WHERE id=$1', [jobId])
      ).rows[0];
      expect(after).toMatchObject(before);
      expect(after).toMatchObject({
        cleanupContractVersion: 1,
        cleanupEvidence: null,
        observedAbsentAt: null,
        status: "DONE",
        settlementProofReference: "synthetic:historical-v1-proof",
        settlementLeaseToken: leaseToken,
      });
      expect(
        (
          await client.query(
            'SELECT "sourceProtocolVersion", "providerExposureBytes" FROM "MediaUploadSession" WHERE id=$1',
            [sessionId],
          )
        ).rows[0],
      ).toEqual({ sourceProtocolVersion: 1, providerExposureBytes: null });
      expect(
        (
          await client.query(
            'SELECT "providerOutcome", "providerTerminalAt", "providerUploadId" FROM "MediaUploadOperation" WHERE "sessionId"=$1 ORDER BY id',
            [sessionId],
          )
        ).rows,
      ).toEqual([
        { providerOutcome: "NOT_DISPATCHED", providerTerminalAt: null, providerUploadId: null },
        { providerOutcome: "NOT_DISPATCHED", providerTerminalAt: null, providerUploadId: null },
      ]);
      await expect(
        client.query(
          'UPDATE "PrivacyMediaDeletionJob" SET "settlementProofReference"=NULL WHERE id=$1',
          [jobId],
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          'UPDATE "PrivacyMediaDeletionJob" SET "cleanupContractVersion"=2 WHERE id=$1',
          [jobId],
        ),
      ).rejects.toThrow();
      await expect(
        client.query('UPDATE "MediaUploadSession" SET "sourceProtocolVersion"=2 WHERE id=$1', [
          sessionId,
        ]),
      ).rejects.toThrow();
      await expect(
        client.query('UPDATE "PrivacyMediaDeletionJob" SET "sessionRevision"=NULL WHERE id=$1', [
          jobId,
        ]),
      ).rejects.toThrow();
      expect(
        (await client.query('SELECT status FROM "PrivacyMediaDeletionJob" WHERE id=$1', [jobId]))
          .rows[0].status,
      ).toBe("DONE");
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
      await pool.end();
    }
  }, 60_000);
});
