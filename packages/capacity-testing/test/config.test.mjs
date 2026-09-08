import assert from "node:assert/strict";
import test from "node:test";
import { loadCapacityConfig, profiles } from "../src/config.mjs";

test("loads a guarded local smoke profile", () => {
  const config = loadCapacityConfig({
    AYIN_CAPACITY_ENVIRONMENT: "local",
    AYIN_CAPACITY_API_URL: "http://127.0.0.1:4000",
  });
  assert.equal(config.profile, profiles.smoke);
  assert.equal(config.apiUrl.origin, "http://127.0.0.1:4000");
  assert.equal(config.enableMutations, false);
});

test("refuses all AYIN production hosts", () => {
  assert.throws(
    () =>
      loadCapacityConfig({
        AYIN_CAPACITY_ENVIRONMENT: "local",
        AYIN_CAPACITY_API_URL: "https://api.ayin.stream",
      }),
    /protected production host/,
  );
});

test("requires staging confirmation and exact allow-list", () => {
  const base = {
    AYIN_CAPACITY_ENVIRONMENT: "staging",
    AYIN_CAPACITY_API_URL: "https://api.staging.example.test",
    AYIN_CAPACITY_ALLOWED_HOSTS: "api.staging.example.test",
  };
  assert.throws(() => loadCapacityConfig(base), /RUN_SAFE_CAPACITY_TEST/);
  assert.equal(
    loadCapacityConfig({ ...base, AYIN_CAPACITY_RUN_CONFIRMATION: "RUN_SAFE_CAPACITY_TEST" })
      .environment,
    "staging",
  );
});

test("requires a cleanup database before mutations", () => {
  assert.throws(
    () =>
      loadCapacityConfig({
        AYIN_CAPACITY_ENVIRONMENT: "local",
        AYIN_CAPACITY_API_URL: "http://localhost:4000",
        AYIN_CAPACITY_ENABLE_MUTATIONS: "1",
      }),
    /require AYIN_CAPACITY_DATABASE_URL/,
  );
});

test("requires explicit high-load and queue confirmations", () => {
  const base = {
    AYIN_CAPACITY_ENVIRONMENT: "local",
    AYIN_CAPACITY_API_URL: "http://localhost:4000",
    AYIN_CAPACITY_PROFILE: "stress",
  };
  assert.throws(() => loadCapacityConfig(base), /RUN_HIGH_LOAD_PROFILE/);
  assert.throws(
    () =>
      loadCapacityConfig({
        ...base,
        AYIN_CAPACITY_HIGH_LOAD_CONFIRMATION: "RUN_HIGH_LOAD_PROFILE",
        AYIN_CAPACITY_MODE: "queue",
        AYIN_CAPACITY_DATABASE_URL: "postgresql://user:secret@localhost/test",
      }),
    /OBSERVE_SYNTHETIC_QUEUE/,
  );
});

test("never exposes database credentials on a guard failure", () => {
  const secret = "never-print-this";
  assert.throws(
    () =>
      loadCapacityConfig({
        AYIN_CAPACITY_ENVIRONMENT: "local",
        AYIN_CAPACITY_API_URL: "http://localhost:4000",
        AYIN_CAPACITY_DATABASE_URL: `postgresql://user:${secret}@database.example.test/ayin`,
      }),
    (error) => !error.message.includes(secret),
  );
});

test("bounds request timeout configuration", () => {
  assert.throws(
    () =>
      loadCapacityConfig({
        AYIN_CAPACITY_ENVIRONMENT: "local",
        AYIN_CAPACITY_API_URL: "http://localhost:4000",
        AYIN_CAPACITY_TIMEOUT_MS: "0",
      }),
    /100 to 30000/,
  );
});
