import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const historical = "docs/AYIN_PRODUCT_INTEGRATION_MATRIX.json";
const command = "scripts/audit-product-integration.mjs";
const options = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 };
const readReport = () => JSON.parse(execFileSync(process.execPath, [command, "--stdout"], options));

test("stdout inventory is deterministic, complete for tracked files and does not rewrite history", () => {
  const original = readFileSync(historical);
  const first = readReport();
  assert.deepEqual(readReport(), first);
  assert.deepEqual(readFileSync(historical), original);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.currentAcceptanceAuthority, "docs/AYIN_FEATURE_SURFACE_MATRIX.md");
  assert.match(first.sourceSha, /^[a-f0-9]{40}$/);
  const files = execFileSync("git", ["ls-files", "-z"], options).split("\0").filter(Boolean);
  assert.equal(first.counts.files, files.length);
  assert.deepEqual(first.trackedFileEvidence.map((entry) => entry.file), files);
  const evidence = first.trackedFileEvidence.find((entry) => entry.file === command);
  assert.equal(evidence.sha256, createHash("sha256").update(readFileSync(command)).digest("hex"));
  assert.equal(first.counts.routes, first.routes.length);
  assert.equal(first.counts.pages, first.routes.filter((route) => route.kind === "page").length);
  assert.equal(first.counts.endpoints, first.endpoints.length);
  assert.equal(first.counts.features, first.features.length);
  assert.equal(new Set(first.features.map((entry) => entry.feature)).size, first.features.length);
  for (const feature of first.features) {
    assert.ok(feature.semanticReview);
    assert.equal(feature.status, "SOURCE_INVENTORIED_RUNTIME_REVIEW_REQUIRED");
    assert.equal(Object.hasOwn(feature, "gaps"), false);
    assert.equal(typeof feature.historicalCandidateGap, "string");
  }
  for (const route of first.routes) {
    assert.equal(route.runtimeVerified, false);
    assert.ok(files.includes(route.file));
  }
  for (const file of first.backendFiles) assert.ok(files.includes(file));
  for (const endpoint of first.endpoints) {
    assert.ok(first.backendFiles.includes(endpoint.file));
    assert.match(endpoint.authorization, /not proof/);
  }
});

test("unsupported arguments fail before any document mutation", () => {
  const original = readFileSync(historical);
  for (const args of [["--unknown"], ["--stdout", "--unknown"]]) {
    const result = spawnSync(process.execPath, [command, ...args], options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.deepEqual(readFileSync(historical), original);
  }
});
