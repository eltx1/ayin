#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { loadCapacityConfig } from "./config.mjs";
import { runCapacity } from "./runner.mjs";

try {
  const config = loadCapacityConfig();
  const report = await runCapacity(config);
  await writeFile(config.outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const summary = report.http.overall ?? report.resources.postgres.worker ?? {};
  console.log(
    JSON.stringify({
      runId: report.runId,
      profile: report.profile.name,
      mode: report.mode,
      stopReason: report.stopReason,
      summary,
      report: config.outputPath,
    }),
  );
  if (report.cleanup.status === "failed" || report.stopReason === "safety_error_rate")
    process.exitCode = 1;
} catch (error) {
  console.error(
    `Capacity run refused or failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
