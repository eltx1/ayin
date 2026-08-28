import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
