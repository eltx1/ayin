import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { requireTestDatabase } from "./test-database-guard.mjs";

const url = "postgresql://ayin_test:synthetic@127.0.0.1:55432/ayin_test_audit?schema=public";
const safe = { APP_ENV: "test", TEST_DATABASE_URL: url, DATABASE_URL: url };
test("accepts explicit disposable loopback test database", () => {
  assert.equal(requireTestDatabase(safe), url);
  assert.equal(requireTestDatabase({ ...safe, DATABASE_URL: undefined }), url);
});
for (const [label, env] of Object.entries({
  "missing test URL cannot fall back": { APP_ENV: "test", DATABASE_URL: url },
  "application environment alone is insufficient": { APP_ENV: "test" },
  "production environment": { ...safe, APP_ENV: "production" },
  "production database name": {
    ...safe,
    TEST_DATABASE_URL: url.replace("/ayin_test_audit", "/ayin"),
  },
  "production role": { ...safe, TEST_DATABASE_URL: url.replace("//ayin_test:", "//ayin_app:") },
  "remote host": { ...safe, TEST_DATABASE_URL: url.replace("127.0.0.1", "db.example.invalid") },
  "conflicting application database": {
    ...safe,
    DATABASE_URL: url.replace("/ayin_test_audit", "/ayin"),
  },
  "query host override": {
    ...safe,
    DATABASE_URL: undefined,
    TEST_DATABASE_URL: url + "&host=production.invalid",
  },
  "query role override": {
    ...safe,
    DATABASE_URL: undefined,
    TEST_DATABASE_URL: url + "&user=ayin_app",
  },
  "encoded production path": {
    ...safe,
    DATABASE_URL: undefined,
    TEST_DATABASE_URL: url.replace("ayin_test_audit", "%61yin"),
  },
  "malformed URL": { ...safe, TEST_DATABASE_URL: "private-value-not-a-url" },
})) {
  test(`rejects ${label} without exposing credentials`, () => {
    assert.throws(
      () => requireTestDatabase(env),
      (error) => {
        assert.match(error.message, /Destructive tests require/);
        assert.doesNotMatch(error.message, /synthetic|private-value|production\.invalid/);
        return true;
      },
    );
  });
}
test("runner fails before executing child when test database is absent", () => {
  const env = { ...process.env, APP_ENV: "test" };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_URL;
  const result = spawnSync(
    process.execPath,
    [
      new URL("./with-test-database.mjs", import.meta.url).pathname,
      process.execPath,
      "-e",
      "console.log('CHILD_EXECUTED')",
    ],
    { env, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /CHILD_EXECUTED/);
});
