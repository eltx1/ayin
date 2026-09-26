import { spawnSync } from "node:child_process";
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
