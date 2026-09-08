import { randomUUID } from "node:crypto";
import { buildScenarios } from "./scenarios.mjs";
import { PostgresMetrics, ProcessMetrics, summarizeResults } from "./metrics.mjs";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function buildSchedule(scenarios, budget) {
  const bounded = scenarios.filter((scenario) => scenario.maxIterations);
  const schedule = bounded.flatMap((scenario) =>
    Array.from({ length: scenario.maxIterations }, () => scenario),
  );
  const weighted = scenarios.filter((scenario) => scenario.weight > 0);
  if (!weighted.length && schedule.length < budget)
    throw new Error("No unbounded HTTP scenarios are configured");
  for (let index = schedule.length; index < budget; index += 1)
    schedule.push(weighted[index % weighted.length]);
  return schedule;
}

function aggregateByScenario(results, elapsedMs) {
  return Object.fromEntries(
    [...new Set(results.map((result) => result.scenario))].map((name) => [
      name,
      summarizeResults(
        results.filter((result) => result.scenario === name),
        elapsedMs,
      ),
    ]),
  );
}

export async function runCapacity(config, dependencies = {}) {
  const now = dependencies.now ?? (() => Date.now());
  const wait = dependencies.sleep ?? sleep;
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const runId = randomUUID();
  const state = { assetIds: [] };
  const postgres =
    dependencies.postgres ?? (config.databaseUrl ? new PostgresMetrics(config.databaseUrl) : null);
  const processMetrics = dependencies.processMetrics ?? new ProcessMetrics(config.targetPids);
  const results = [];
  const resourceErrors = [];
  const startedAt = now();
  let stopReason = null;
  let timer = null;

  const sampleResources = async () => {
    try {
      if (postgres) await postgres.sample();
    } catch (error) {
      resourceErrors.push(`database:${error.name}`);
    }
    try {
      await processMetrics.sample();
    } catch (error) {
      resourceErrors.push(`process:${error.name}`);
    }
  };

  try {
    await sampleResources();
    timer = setInterval(() => void sampleResources(), 1_000);
    if (config.mode === "queue") {
      await wait(config.profile.durationSeconds * 1_000);
      stopReason = "duration_complete";
    } else {
      const scenarios = buildScenarios(config, state);
      const schedule = buildSchedule(scenarios, config.profile.requestBudget);
      const active = new Set();
      const intervalMs = 1_000 / config.profile.requestsPerSecond;
      for (let index = 0; index < schedule.length; index += 1) {
        const elapsed = now() - startedAt;
        if (elapsed >= config.profile.durationSeconds * 1_000) {
          stopReason = "duration_complete";
          break;
        }
        const dueAt = startedAt + index * intervalMs;
        if (now() < dueAt) await wait(dueAt - now());
        while (active.size >= config.profile.concurrency) await Promise.race(active);
        const task = schedule[index]
          .run({ config, fetch: fetchImplementation, now, runId })
          .then((value) => results.push(value))
          .catch((error) =>
            results.push({
              scenario: schedule[index].name,
              ok: false,
              latencyMs: 0,
              classification: error.name,
              networkRequests: 0,
            }),
          )
          .finally(() => active.delete(task));
        active.add(task);

        if (results.length >= 50 && results.length % 10 === 0) {
          const recent = results.slice(-50);
          const errorRate = recent.filter((result) => !result.ok).length / recent.length;
          if (errorRate > 0.1) {
            stopReason = "safety_error_rate";
            break;
          }
        }
      }
      await Promise.all(active);
      stopReason ??= "request_budget_complete";
    }
    await sampleResources();
  } finally {
    if (timer) clearInterval(timer);
  }

  const elapsedMs = Math.max(1, now() - startedAt);
  let cleanup = { status: "not_required" };
  if (config.enableMutations && postgres) {
    try {
      await postgres.cleanup(runId, state.assetIds);
      cleanup = {
        status: "completed",
        analyticsRunId: runId,
        rejectedAssets: state.assetIds.length,
      };
    } catch (error) {
      cleanup = { status: "failed", error: error.name };
    }
  }
  const report = {
    schemaVersion: 1,
    runId,
    measuredAt: new Date().toISOString(),
    releaseSha: config.releaseSha,
    environment: config.environment,
    target: { apiOrigin: config.apiUrl.origin },
    profile: { name: config.profileName, ...config.profile },
    mode: config.mode,
    elapsedMs,
    stopReason,
    http:
      config.mode === "http"
        ? {
            overall: summarizeResults(results, elapsedMs),
            scenarios: aggregateByScenario(results, elapsedMs),
          }
        : { status: "not_run" },
    resources: {
      postgres: postgres ? postgres.summarize(elapsedMs) : { status: "not_configured" },
      processes: processMetrics.summarize(),
      sampleErrors: resourceErrors,
    },
    cleanup,
  };
  if (postgres && !dependencies.postgres) await postgres.close();
  return report;
}

export const runnerInternals = { aggregateByScenario, buildSchedule };
