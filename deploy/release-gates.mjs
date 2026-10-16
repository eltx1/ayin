#!/usr/bin/env node
// Read-only GitHub release evidence. Never executes artifact content or reaches production.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// All three run on every main push. Native/store/provider acceptance remains a
// separate launch decision, not an implicit prerequisite for every Web release.
export const REQUIRED_GATES = [
  {
    key: "quality",
    path: ".github/workflows/database.yml",
    name: "Task quality gates",
    jobs: ["quality"],
  },
  {
    key: "security",
    path: ".github/workflows/security.yml",
    name: "Security gates",
    jobs: [
      "Lockfile, production audit and SBOM",
      "Secret detection",
      "CodeQL JavaScript and TypeScript",
    ],
  },
  {
    key: "browser",
    path: ".github/workflows/e2e.yml",
    name: "V1 browser acceptance",
    jobs: ["e2e"],
  },
];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const validId = (id) => /^[1-9][0-9]*$/.test(String(id));
const validSha = (sha) => /^[0-9a-f]{40}$/.test(sha ?? "");

export function validateRun(run, gate, { sha, repository }) {
  assert(validId(run.id) && validId(run.run_attempt), `${gate.key}: invalid run identity`);
  assert(run.path === gate.path && run.name === gate.name, `${gate.key}: untrusted workflow`);
  assert(run.event === "push" && run.head_branch === "main", `${gate.key}: not a main push`);
  assert(
    run.repository?.full_name === repository && run.head_repository?.full_name === repository,
    `${gate.key}: untrusted repository`,
  );
  assert(run.head_sha === sha, `${gate.key}: wrong SHA`);
  assert(
    run.status === "completed" && run.conclusion === "success",
    `${gate.key}: gate did not succeed`,
  );
}

export function validateJobs(jobs, gate, run) {
  for (const name of gate.jobs) {
    const matches = jobs.filter((job) => job.name === name);
    assert(matches.length === 1, `${gate.key}: required job missing or ambiguous: ${name}`);
    const job = matches[0];
    assert(
      job.run_id === run.id && job.head_sha === run.head_sha,
      `${gate.key}: job identity mismatch`,
    );
    assert(
      job.status === "completed" && job.conclusion === "success",
      `${gate.key}: required job did not succeed: ${name}`,
    );
  }
}

export async function checkGates({ get, sha, repository, automatic = false, validationRunId }) {
  assert(validSha(sha), "Invalid release SHA");
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""), "Invalid repository");
  const base = `/repos/${repository}`;
  if (automatic) {
    const branch = await get(`${base}/branches/main`);
    assert(branch.commit?.sha === sha, "Automatic release is superseded by current main");
  }
  const evidence = {};
  const pending = [];
  for (const gate of REQUIRED_GATES) {
    // GitHub returns newest runs first; never fall back to an older success when
    // the newest execution has failed, was skipped, or is being rerun.
    const result = await get(
      `${base}/actions/workflows/${gate.path.split("/").at(-1)}/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
    );
    const runs = result.workflow_runs ?? [];
    const run = [...runs].sort((a, b) => b.run_number - a.run_number || b.id - a.id)[0];
    if (!run) {
      pending.push(`${gate.key}: missing`);
      continue;
    }
    if (gate.key === "quality" && validationRunId) {
      assert(
        String(run.id) === String(validationRunId),
        "Requested quality run is not the latest exact-SHA run",
      );
    }
    if (run.status !== "completed") {
      pending.push(`${gate.key}: pending`);
      continue;
    }
    validateRun(run, gate, { sha, repository });
    const jobs = [];
    for (let page = 1; ; page++) {
      const result = await get(
        `${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      );
      jobs.push(...result.jobs);
      if (jobs.length >= result.total_count) break;
      assert(page < 20 && result.jobs.length > 0, "Incomplete jobs response");
    }
    validateJobs(jobs, gate, run);
    evidence[gate.key] = { runId: String(run.id), runAttempt: String(run.run_attempt) };
  }
  if (pending.length) {
    assert(automatic, `Release evidence unavailable: ${pending.join(", ")}`);
    return { ready: false, pending };
  }
  return { ready: true, sha, repository, gates: evidence };
}

export async function alreadyDeployed({ get, sha, repository }) {
  const base = `/repos/${repository}`;
  const result = await get(
    `${base}/actions/workflows/deploy.yml/runs?head_sha=${sha}&status=success&per_page=100`,
  );
  for (const run of result.workflow_runs ?? []) {
    if (
      run.path !== ".github/workflows/deploy.yml" ||
      run.name !== "Production deployment" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.head_sha !== sha ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository ||
      !["workflow_run", "workflow_dispatch"].includes(run.event)
    )
      continue;
    for (let page = 1; ; page++) {
      const result = await get(
        `${base}/actions/runs/${run.id}/artifacts?per_page=100&page=${page}`,
      );
      if (
        result.artifacts.some(
          (artifact) =>
            artifact.name === `ayin-production-deploy-proof-${sha}` &&
            artifact.expired === false &&
            artifact.size_in_bytes > 0 &&
            artifact.workflow_run?.id === run.id,
        )
      )
        return true;
      if (page * 100 >= result.total_count) break;
      assert(page < 20 && result.artifacts.length > 0, "Incomplete deployment artifacts response");
    }
  }
  return false;
}

export async function checkDeploymentRun({ get, repository, runId }) {
  assert(validId(runId), "Invalid deployment run ID");
  const base = `/repos/${repository}`;
  const run = await get(`${base}/actions/runs/${runId}`);
  assert(
    run.name === "Production deployment" && run.path === ".github/workflows/deploy.yml",
    "Untrusted deployment workflow",
  );
  assert(
    run.repository?.full_name === repository && run.head_repository?.full_name === repository,
    "Untrusted deployment repository",
  );
  assert(
    run.status === "completed" && run.conclusion === "success",
    "Deployment workflow did not succeed",
  );
  const result = await get(
    `${base}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`,
  );
  assert(result.total_count <= 100, "Incomplete deployment jobs response");
  const deployments = result.jobs.filter((job) => job.name === "deploy");
  assert(deployments.length === 1, "Deployment job missing or ambiguous");
  // An earlier gate completion can legitimately finish with deploy skipped.
  return deployments[0].status === "completed" && deployments[0].conclusion === "success";
}

export async function archiveDigest(path) {
  const stat = await lstat(path);
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 512 * 1024 * 1024,
    "Invalid Web archive",
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function validateManifest(manifest, { sha, repository, runId, runAttempt }, checksum) {
  assert(manifest.schemaVersion === 1, "Unknown release provenance schema");
  assert(manifest.sha === sha && validSha(sha), "Artifact SHA mismatch");
  assert(manifest.repository === repository, "Artifact repository mismatch");
  assert(
    manifest.workflow === REQUIRED_GATES[0].path &&
      manifest.event === "push" &&
      manifest.ref === "refs/heads/main",
    "Untrusted artifact source",
  );
  assert(String(manifest.runId) === String(runId) && validId(runId), "Artifact run ID mismatch");
  assert(
    String(manifest.runAttempt) === String(runAttempt) && validId(runAttempt),
    "Artifact run attempt mismatch",
  );
  assert(
    /^[0-9a-f]{64}$/.test(checksum) && manifest.archiveSha256 === checksum,
    "Artifact checksum mismatch",
  );
}

async function githubGet(path) {
  assert(process.env.GH_TOKEN, "GitHub read token unavailable");
  assert(path.startsWith(`/repos/${process.env.GITHUB_REPOSITORY}/`), "Unexpected GitHub API path");
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `GitHub evidence request failed: HTTP ${response.status}`);
  return response.json();
}

async function output(key, value, file = process.env.GITHUB_OUTPUT) {
  assert(file, "GitHub output path missing");
  assert(!String(value).includes("\n"), "Invalid output value");
  await appendFile(file, `${key}=${value}\n`);
}

async function main(command, artifactDir) {
  const env = process.env;
  if (command === "edge-check") {
    await output(
      "ready",
      String(
        await checkDeploymentRun({
          get: githubGet,
          repository: env.GITHUB_REPOSITORY,
          runId: env.DEPLOY_RUN_ID,
        }),
      ),
    );
    return;
  }
  if (command === "check") {
    const result = await checkGates({
      get: githubGet,
      sha: env.RELEASE_SHA,
      repository: env.GITHUB_REPOSITORY,
      automatic: env.AUTOMATIC_RELEASE === "true",
      validationRunId: env.VALIDATION_RUN_ID,
    });
    // The three workflow_run events are serialized by workflow concurrency. Only
    // the first eligible event deploys; later events require existing immutable proof.
    if (
      result.ready &&
      env.CHECK_DUPLICATE_RELEASE === "true" &&
      env.AUTOMATIC_RELEASE === "true" &&
      (await alreadyDeployed({
        get: githubGet,
        sha: env.RELEASE_SHA,
        repository: env.GITHUB_REPOSITORY,
      }))
    ) {
      await output("ready", "false");
      console.log(
        "This SHA already has successful production deployment proof; no duplicate deployment.",
      );
      return;
    }
    await output("ready", String(result.ready));
    if (!result.ready) {
      console.log(
        `Release not ready: ${result.pending.join(", ")}. A remaining gate's completion will re-evaluate it.`,
      );
      return;
    }
    for (const [key, gate] of Object.entries(result.gates)) {
      await output(`${key}_run_id`, gate.runId);
      await output(`${key}_run_attempt`, gate.runAttempt);
    }
    console.log(
      `All required workflows and jobs passed for ${result.sha}. CodeQL execution success is not a claim of zero alerts.`,
    );
    return;
  }
  assert(artifactDir, "Artifact directory missing");
  const archive = resolve(artifactDir, "ayin-web-build.tar.gz");
  const manifestPath = resolve(artifactDir, "release-provenance.json");
  const digest = await archiveDigest(archive);
  if (command === "manifest-create") {
    const manifest = {
      schemaVersion: 1,
      sha: env.GITHUB_SHA,
      repository: env.GITHUB_REPOSITORY,
      workflow: REQUIRED_GATES[0].path,
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      archiveSha256: digest,
    };
    // PR artifacts are useful evidence but intentionally not deployable.
    assert(
      validSha(manifest.sha) && validId(manifest.runId) && validId(manifest.runAttempt),
      "Invalid build provenance",
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } else if (command === "manifest-verify") {
    const stat = await lstat(manifestPath);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096, "Invalid provenance file");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    validateManifest(
      manifest,
      {
        sha: env.RELEASE_SHA,
        repository: env.GITHUB_REPOSITORY,
        runId: env.VALIDATION_RUN_ID,
        runAttempt: env.VALIDATION_RUN_ATTEMPT,
      },
      digest,
    );
    await output("WEB_BUILD_SHA256", digest, env.GITHUB_ENV);
  } else throw new Error("Unknown release evidence command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
