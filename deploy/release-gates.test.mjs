import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  alreadyDeployed,
  archiveDigest,
  checkDeploymentRun,
  checkGates,
  REQUIRED_GATES,
  validateManifest,
} from "./release-gates.mjs";

const sha = "a".repeat(40);
const repository = "eltx1/ayin";
function fixture() {
  const runs = REQUIRED_GATES.map((gate, i) => ({
    id: i + 10,
    run_number: i + 20,
    run_attempt: 2,
    name: gate.name,
    path: gate.path,
    event: "push",
    head_branch: "main",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  }));
  const jobs = Object.fromEntries(
    REQUIRED_GATES.map((gate, i) => [
      runs[i].id,
      gate.jobs.map((name) => ({
        name,
        run_id: runs[i].id,
        head_sha: sha,
        status: "completed",
        conclusion: "success",
      })),
    ]),
  );
  const state = { runs, jobs, mainSha: sha };
  const get = async (path) => {
    if (path.endsWith("/branches/main")) return { commit: { sha: state.mainSha } };
    const gate = REQUIRED_GATES.find((item) =>
      path.includes(`/workflows/${item.path.split("/").at(-1)}/runs?`),
    );
    if (gate)
      return {
        workflow_runs: state.runs.filter(
          (run) => run.gateKey === gate.key || run.path === gate.path,
        ),
      };
    const match = path.match(/\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100&page=(\d+)$/);
    if (match) {
      assert.equal(
        Number(match[2]),
        state.runs.find((run) => run.id === Number(match[1])).run_attempt,
      );
      const items = state.jobs[match[1]];
      return {
        jobs: items.slice((Number(match[3]) - 1) * 100, Number(match[3]) * 100),
        total_count: items.length,
      };
    }
    throw new Error(`Unexpected evidence request ${path}`);
  };
  return { state, get };
}
const options = (fixture, extras = {}) => ({ get: fixture.get, sha, repository, ...extras });

test("accepts only the three successful exact-SHA main runs and their required jobs", async () => {
  const f = fixture();
  assert.deepEqual(await checkGates(options(f, { automatic: true })), {
    ready: true,
    sha,
    repository,
    gates: {
      quality: { runId: "10", runAttempt: "2" },
      security: { runId: "11", runAttempt: "2" },
      browser: { runId: "12", runAttempt: "2" },
    },
  });
});
for (const [i, gate] of REQUIRED_GATES.entries()) {
  for (const conclusion of ["failure", "skipped", "cancelled"]) {
    test(`rejects ${gate.key} independently when ${conclusion}`, async () => {
      const f = fixture();
      f.state.runs[i].conclusion = conclusion;
      await assert.rejects(checkGates(options(f)), /gate did not succeed/);
    });
  }
  test(`does not treat a missing ${gate.key} as success or block waiting`, async () => {
    const f = fixture();
    f.state.runs.splice(i, 1);
    assert.equal((await checkGates(options(f, { automatic: true }))).ready, false);
    await assert.rejects(checkGates(options(f)), /evidence unavailable/);
  });
  test(`rejects a skipped required ${gate.key} job even if workflow is green`, async () => {
    const f = fixture();
    f.state.jobs[f.state.runs[i].id][0].conclusion = "skipped";
    await assert.rejects(checkGates(options(f)), /required job did not succeed/);
  });
}
for (const [field, value, error] of [
  ["head_sha", "b".repeat(40), /wrong SHA/],
  ["event", "pull_request", /not a main push/],
  ["head_branch", "feature", /not a main push/],
  ["head_repository", { full_name: "attacker/ayin" }, /untrusted repository/],
  ["repository", { full_name: "attacker/ayin" }, /untrusted repository/],
  ["path", ".github/workflows/untrusted.yml", /untrusted workflow/],
]) {
  test(`rejects untrusted run ${field}`, async () => {
    const f = fixture();
    f.state.runs[0].gateKey = "quality";
    f.state.runs[0][field] = value;
    await assert.rejects(checkGates(options(f)), error);
  });
}
test("refuses old successful quality evidence when latest exact-SHA execution fails", async () => {
  const f = fixture();
  f.state.runs.push({ ...f.state.runs[0], id: 99, run_number: 99, conclusion: "failure" });
  await assert.rejects(checkGates(options(f)), /gate did not succeed/);
});
test("does not treat an in-progress rerun as success", async () => {
  const f = fixture();
  f.state.runs[0].status = "in_progress";
  assert.equal((await checkGates(options(f, { automatic: true }))).ready, false);
});
test("explicit run ID cannot select older success", async () => {
  await assert.rejects(
    checkGates(options(fixture(), { validationRunId: "123" })),
    /not the latest/,
  );
});
test("rejects superseded automatic release; explicit historical rollback still needs all gates", async () => {
  const f = fixture();
  f.state.mainSha = "b".repeat(40);
  await assert.rejects(checkGates(options(f, { automatic: true })), /superseded/);
  assert.equal((await checkGates(options(f))).ready, true);
});
test("required job cannot belong to a different commit or run", async () => {
  const f = fixture();
  f.state.jobs[10][0].head_sha = "b".repeat(40);
  await assert.rejects(checkGates(options(f)), /identity mismatch/);
});
test("paginates job evidence instead of losing required jobs after page one", async () => {
  const f = fixture();
  f.state.jobs[10].unshift(...Array.from({ length: 101 }, (_, i) => ({ name: `extra-${i}` })));
  assert.equal((await checkGates(options(f))).ready, true);
});
const digest = createHash("sha256").update("test artifact").digest("hex");
const expected = { sha, repository, runId: "10", runAttempt: "2" };
const manifest = {
  schemaVersion: 1,
  sha,
  repository,
  workflow: REQUIRED_GATES[0].path,
  event: "push",
  ref: "refs/heads/main",
  runId: "10",
  runAttempt: "2",
  archiveSha256: digest,
};
test("binds trusted artifact bytes to source SHA, workflow, repository, run and attempt", () =>
  validateManifest(manifest, expected, digest));
for (const [field, value] of [
  ["sha", "b".repeat(40)],
  ["repository", "attacker/ayin"],
  ["workflow", ".github/workflows/e2e.yml"],
  ["event", "pull_request"],
  ["ref", "refs/pull/1/merge"],
  ["runId", "11"],
  ["runAttempt", "1"],
  ["archiveSha256", "0".repeat(64)],
]) {
  test(`rejects artifact provenance mismatch: ${field}`, () =>
    assert.throws(() => validateManifest({ ...manifest, [field]: value }, expected, digest)));
}
test("rejects absent archive and verifies actual bytes, not filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ayin-release-gate-"));
  try {
    const path = join(dir, "ayin-web-build.tar.gz");
    await assert.rejects(archiveDigest(path), { code: "ENOENT" });
    await writeFile(path, "test artifact");
    validateManifest(manifest, expected, await archiveDigest(path));
    await writeFile(path, "modified artifact");
    assert.throws(() =>
      validateManifest(manifest, expected, digest.replace(/^./, digest[0] === "0" ? "1" : "0")),
    );
    assert.throws(
      () =>
        validateManifest(
          manifest,
          expected,
          createHash("sha256").update("modified artifact").digest("hex"),
        ),
      /checksum mismatch/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("edge proof requires actual deployment, not a green preflight-only workflow", async () => {
  for (const [conclusion, expected] of [
    ["skipped", false],
    ["success", true],
  ]) {
    const get = async (path) =>
      path.includes("/jobs?")
        ? { total_count: 1, jobs: [{ name: "deploy", status: "completed", conclusion }] }
        : {
            name: "Production deployment",
            path: ".github/workflows/deploy.yml",
            status: "completed",
            conclusion: "success",
            run_attempt: 1,
            repository: { full_name: repository },
            head_repository: { full_name: repository },
          };
    assert.equal(await checkDeploymentRun({ get, repository, runId: "15" }), expected);
  }
});

const workflowRoot = process.env.AYIN_RELEASE_WORKFLOW_ROOT ?? new URL("../", import.meta.url);
for (const gate of REQUIRED_GATES) {
  test(`${gate.key} creates evidence on shared package, .nvmrc, Web, API and DB-only changes`, async () => {
    const text = await readFile(
      new URL(
        gate.path,
        typeof workflowRoot === "string" ? new URL(`file://${workflowRoot}/`) : workflowRoot,
      ),
      "utf8",
    );
    const triggers = text.slice(text.indexOf("on:\n"), text.indexOf("\npermissions:"));
    assert.match(triggers, /\n {2}push:\n {4}branches: \[main\]/);
    assert.match(triggers, /\n {2}pull_request: \{\}/);
    assert.doesNotMatch(triggers, /paths(?:-ignore)?:/);
  });
}
test("every prerequisite completion can re-evaluate readiness without a workflow cycle", async () => {
  const text = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  for (const gate of REQUIRED_GATES) assert.ok(text.includes(`      - ${gate.name}\n`));
  assert.ok(text.indexOf("release-evidence:") < text.indexOf("    environment: production"));
  assert.match(text, /needs: release-evidence/);
  assert.match(text, /digest-mismatch: error/);
});

test("three completed gate events cannot redeploy a SHA with trusted deployment proof", async () => {
  const run = {
    id: 25,
    path: ".github/workflows/deploy.yml",
    name: "Production deployment",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    event: "workflow_run",
  };
  const artifact = {
    name: `ayin-production-deploy-proof-${sha}`,
    expired: false,
    size_in_bytes: 1024,
    workflow_run: { id: 25 },
  };
  const state = { run, artifact };
  const get = async (path) =>
    path.includes("/artifacts?")
      ? { total_count: 1, artifacts: [state.artifact] }
      : { workflow_runs: [state.run] };
  assert.equal(await alreadyDeployed({ get, sha, repository }), true);
  state.artifact = { ...artifact, name: "a-build-without-deployment" };
  assert.equal(await alreadyDeployed({ get, sha, repository }), false);
  state.artifact = { ...artifact, expired: true };
  assert.equal(await alreadyDeployed({ get, sha, repository }), false);
  state.artifact = artifact;
  state.run = { ...run, head_repository: { full_name: "attacker/ayin" } };
  assert.equal(await alreadyDeployed({ get, sha, repository }), false);
});

test("artifact names isolate rerun attempts while the download selects the exact quality run", async () => {
  const source = await readFile(
    new URL("../.github/workflows/database.yml", import.meta.url),
    "utf8",
  );
  const consumer = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(
      "name: ayin-web-build-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    ),
  );
  assert.ok(
    consumer.includes(
      "name: ayin-web-build-${{ env.RELEASE_SHA }}-${{ env.VALIDATION_RUN_ID }}-${{ env.VALIDATION_RUN_ATTEMPT }}",
    ),
  );
  assert.ok(consumer.includes("run-id: ${{ env.VALIDATION_RUN_ID }}"));
});

test("deployment always revalidates with current trusted policy rather than rollback-era code", async () => {
  const text = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(text.includes("path: .release-policy"));
  assert.ok(text.includes("ref: ${{ github.workflow_sha }}"));
  assert.ok(text.includes("node .release-policy/deploy/release-gates.mjs check"));
  assert.ok(text.includes("node .release-policy/deploy/release-gates.mjs manifest-verify"));
});
