import assert from "node:assert/strict";
import test from "node:test";
import { runCapacity, runnerInternals } from "../src/runner.mjs";

const processMetrics = {
  async sample() {},
  summarize() {
    return { status: "not_configured" };
  },
};

function baseConfig() {
  return {
    environment: "local",
    profileName: "smoke",
    profile: { durationSeconds: 10, requestsPerSecond: 2, concurrency: 2, requestBudget: 6 },
    mode: "http",
    apiUrl: new URL("http://localhost:4000/"),
    databaseUrl: null,
    enableMutations: false,
    watchSlug: "safe-video",
    searchQuery: "video",
    loginEmail: null,
    loginPassword: null,
    uploadChannelId: null,
    targetPids: null,
    releaseSha: "abc123",
    timeoutMs: 500,
  };
}

test("buildSchedule honors bounded checks and fills with weighted scenarios", () => {
  const read = { name: "read", weight: 1 };
  const bounded = { name: "bounded", weight: 0, maxIterations: 2 };
  const schedule = runnerInternals.buildSchedule([read, bounded], 5);
  assert.deepEqual(
    schedule.map((scenario) => scenario.name),
    ["bounded", "bounded", "read", "read", "read"],
  );
});

test("runs the configured request budget and reports per-scenario latency", async () => {
  let clock = 0;
  const fetch = async (url) => {
    clock += 5;
    if (url.pathname === "/auth/register")
      return new Response(JSON.stringify({ error: "validation" }), { status: 400 });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };
  const report = await runCapacity(baseConfig(), {
    fetch,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    processMetrics,
  });
  assert.equal(report.http.overall.iterations, 6);
  assert.equal(report.http.overall.errors, 0);
  assert.equal(report.stopReason, "request_budget_complete");
  assert.equal(report.releaseSha, "abc123");
  assert.ok(report.http.scenarios.public_catalog);
  assert.ok(report.http.scenarios.registration_validation);
});

test("stops after a confirmed high error rate", async () => {
  let clock = 0;
  const config = baseConfig();
  config.profile = {
    durationSeconds: 100,
    requestsPerSecond: 100,
    concurrency: 10,
    requestBudget: 100,
  };
  config.watchSlug = null;
  const report = await runCapacity(config, {
    fetch: async () => {
      clock += 1;
      return new Response("failure", { status: 503 });
    },
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    processMetrics,
  });
  assert.equal(report.stopReason, "safety_error_rate");
  assert.ok(report.http.overall.iterations >= 50);
  assert.ok(report.http.overall.iterations < 100);
});

test("queue mode records DB and worker metrics without HTTP calls", async () => {
  let clock = 0;
  let samples = 0;
  const postgres = {
    async sample() {
      samples += 1;
    },
    summarize() {
      return { status: "measured", worker: { queueGrowth: -2, completedJobs: 2 } };
    },
  };
  const config = { ...baseConfig(), mode: "queue", databaseUrl: "configured" };
  const report = await runCapacity(config, {
    postgres,
    processMetrics,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    fetch: async () => {
      throw new Error("HTTP must not run in queue mode");
    },
  });
  assert.equal(report.http.status, "not_run");
  assert.equal(report.resources.postgres.worker.completedJobs, 2);
  assert.equal(samples, 2);
});
