#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { NullAlertAdapter, runConfirmedSyntheticChecks } from "./checker.mjs";
import { loadSyntheticConfig } from "./config.mjs";

const reportArgument = process.argv.find((argument) => argument.startsWith("--report="));
const reportPath = resolve(reportArgument?.slice("--report=".length) || "synthetic-report.json");

try {
  const config = loadSyntheticConfig();
  const report = await runConfirmedSyntheticChecks(config, {
    // No delivery provider is configured in Task 45. A future provider must implement notify(payload).
    alertAdapter: new NullAlertAdapter(),
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  console.log(
    JSON.stringify({
      event: "ayin.synthetic.completed",
      status: report.status,
      summary: report.summary,
      releaseShas: report.releaseShas,
      alert: report.alert,
      reportPath,
    }),
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(report), { flag: "a" });
  }

  if (report.status === "failed") process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      event: "ayin.synthetic.configuration_error",
      message: error instanceof Error ? error.message : "Synthetic monitoring could not start.",
    }),
  );
  process.exitCode = 2;
}

function markdownSummary(report) {
  const rows = report.checks
    .map(
      (check) =>
        `| ${check.label} | ${check.status} | ${check.severity} | ${check.classification ?? "-"} | ${latestLatency(check)} |`,
    )
    .join("\n");
  return `## AYIN synthetic monitoring\n\nStatus: **${report.status}**  \nRelease SHA(s): ${report.releaseShas.join(", ") || "unavailable"}\n\n| Check | Status | Severity | Classification | Latest latency |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
}

function latestLatency(check) {
  const latency = check.attempts?.at(-1)?.latencyMs;
  return Number.isFinite(latency) ? `${latency} ms` : "-";
}
