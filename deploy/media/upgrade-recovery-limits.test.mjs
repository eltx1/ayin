import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  changes,
  health,
  parseArguments,
  persist,
  prepareEnvironment,
  processState,
  reload,
  upgradeRecoveryLimits,
} from "./upgrade-recovery-limits.mjs";

const require = createRequire(import.meta.url);
const { parseEnvText } = require("../env-file.cjs");
const sentinel = "fixture-secret-never-print-019273";
const original = [
  "# Keep comments, spacing, exports, quotes and newline style exactly.",
  `R2_SECRET_ACCESS_KEY='${sentinel}'`,
  "AYIN_UPLOAD_RECOVERY_V2_ENABLED=1",
  "AYIN_UPLOAD_RECOVERY_AUDIENCE=all",
  "AYIN_UPLOAD_RECOVERY_MAX_OUTSTANDING_SOURCES=8",
  ...Object.entries(changes).map(([key, values], index) =>
    index === 0 ? ` export ${key} = '${values[0]}'  ` : `${key}=${values[0]}`,
  ),
  "UNRELATED_FLAG=keep-this-exactly",
  "",
].join("\r\n");

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "ayin-recovery-limits-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "release");
  await mkdir(join(directory, "apps/api/dist/media"), { recursive: true });
  await mkdir(join(directory, "deploy"), { recursive: true });
  await writeFile(
    join(directory, "deploy/env-file.cjs"),
    await readFile(new URL("../env-file.cjs", import.meta.url)),
  );
  await writeFile(join(directory, "apps/api/package.json"), '{"type":"module"}');
  await writeFile(
    join(directory, "apps/api/dist/media/media-storage.config.js"),
    `
    export function loadMediaStorageConfig(env) {
      if (env.APP_ENV !== "production" || env.NODE_ENV !== "production") throw Error("${sentinel}");
      return {appEnv:env.APP_ENV, mode:"r2", recoveryV2Enabled:env.AYIN_UPLOAD_RECOVERY_V2_ENABLED === "1",
        recoveryAudience:env.AYIN_UPLOAD_RECOVERY_AUDIENCE,
        recoveryMaxOutstandingSources:Number(env.AYIN_UPLOAD_RECOVERY_MAX_OUTSTANDING_SOURCES),
        recoveryDebtAccountBytes:Number(env.AYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES),
        recoveryDebtChannelBytes:Number(env.AYIN_UPLOAD_RECOVERY_DEBT_CHANNEL_BYTES),
        sourceMaxBytes:Number(env.AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES),
        outputEnvelopeBytes:Number(env.AYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES)};
    }
  `,
  );
  await writeFile(
    join(directory, "apps/api/dist/media/media-upload-rollout.js"),
    `
    export function configuredUploadRecovery(config) {
      return {sourceMaxBytes:config.sourceMaxBytes, outputEnvelopeBytes:config.outputEnvelopeBytes};
    }
  `,
  );
  await writeFile(join(directory, "deploy/ecosystem.config.cjs"), "module.exports={apps:[]};");
  const git = (...args) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture release",
  );
  const expectedSha = git("rev-parse", "HEAD");
  const envPath = join(root, "api.env");
  await writeFile(envPath, original, { mode: 0o600 });
  const calls = [];
  const overrides = {
    health: async () => {
      calls.push("health");
    },
    processState: async (_directory, _sha, env) => {
      calls.push(`state:${env.AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES}`);
    },
    reload: async () => {
      calls.push("reload");
    },
    persist: async () => {
      calls.push("save");
    },
    delay: async () => {},
    healthAttempts: 2,
  };
  return {
    root,
    directory,
    envPath,
    expectedSha,
    git,
    calls,
    overrides,
    options: { expectedSha, currentDir: directory, envPath, lockPath: join(root, "deploy.lock") },
  };
}

test("requires full release SHA and explicit apply; rejects unrelated CLI paths/options", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(parseArguments([sha]), { expectedSha: sha, apply: false });
  assert.equal(parseArguments([sha, "--apply"]).apply, true);
  for (const args of [
    [],
    ["main"],
    [sha.slice(0, 12)],
    [sha, "--env-file=/etc/environment"],
    [sha, "--apply", "extra"],
  ])
    assert.throws(() => parseArguments(args));
});

test("invocation through the production-style current symlink still runs argument guards", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ayin-recovery-entry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = join(root, "current-helper.mjs");
  await symlink(fileURLToPath(new URL("./upgrade-recovery-limits.mjs", import.meta.url)), entry);
  assert.throws(
    () =>
      execFileSync(process.execPath, [entry, "not-a-release"], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (error) =>
      error.status === 1 && error.stderr.toString().includes("exact-40-character-release-sha"),
  );
});

test("preserves unrelated bytes, CRLF, quoting and whitespace and changes exactly four values", () => {
  const result = prepareEnvironment(original, parseEnvText);
  const expected = original
    .replace("'134217728'", "'5368709120'")
    .replace("ENVELOPE_BYTES=536870912", "ENVELOPE_BYTES=17179869184")
    .replaceAll("=43486543872", "=1735166787584");
  assert.equal(result.next, expected);
  assert.equal(result.overlay.UNRELATED_FLAG, "keep-this-exactly");
  assert.equal(result.overlay.R2_SECRET_ACCESS_KEY, sentinel);
  assert.equal(
    Object.keys(result.overlay).filter((key) => result.overlay[key] !== result.environment[key])
      .length,
    4,
  );
});

test("rejects missing/duplicate keys, unexpected old values and changed rollout guards", () => {
  for (const text of [
    original.replace("AYIN_UPLOAD_RECOVERY_V2_ENABLED=1", "AYIN_UPLOAD_RECOVERY_V2_ENABLED=0"),
    original.replace("AYIN_UPLOAD_RECOVERY_AUDIENCE=all", "AYIN_UPLOAD_RECOVERY_AUDIENCE=canary"),
    original.replace("OUTSTANDING_SOURCES=8", "OUTSTANDING_SOURCES=7"),
    original.replace("134217728", "134217729"),
    original.replace(/.*AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES.*\r\n/, ""),
    original + "AYIN_UPLOAD_RECOVERY_AUDIENCE=all\r\n",
    original + "AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES=134217728\r\n",
  ])
    assert.throws(() => prepareEnvironment(text, parseEnvText));
});

test("dry-run imports the deployed compiled policy, checks release/health and makes no backup/reload", async (t) => {
  const f = await fixture(t);
  const result = await upgradeRecoveryLimits(f.options, f.overrides);
  assert.equal(result.status, "dry-run");
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.deepEqual(f.calls, ["health", "state:134217728"]);
  assert.equal((await readdir(f.root)).filter((name) => name.includes(".bak")).length, 0);
});

test("wrong deployed SHA, permissive env and old compiled cap all fail before mutation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    upgradeRecoveryLimits({ ...f.options, expectedSha: "0".repeat(40), apply: true }, f.overrides),
    /exact expected release/,
  );
  await chmod(f.envPath, 0o644);
  await assert.rejects(upgradeRecoveryLimits(f.options, f.overrides), /private regular file/);
  await chmod(f.envPath, 0o600);
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        validators: async () => ({
          parseEnvText,
          validate() {
            throw new Error(sentinel);
          },
        }),
      },
    ),
    (error) =>
      error.message.includes("compiled production configuration rejected") &&
      !error.message.includes(sentinel),
  );
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.equal(f.calls.length, 0);
});

test("apply writes a private exact backup and only the intended replacement", async (t) => {
  const f = await fixture(t);
  const result = await upgradeRecoveryLimits({ ...f.options, apply: true }, f.overrides);
  assert.equal(result.status, "applied");
  assert.equal(await readFile(result.backupPath, "utf8"), original);
  assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
  assert.equal((await stat(f.envPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(f.envPath, "utf8"), prepareEnvironment(original, parseEnvText).next);
  assert.deepEqual(f.calls, [
    "health",
    "state:134217728",
    "reload",
    "health",
    "state:5368709120",
    "save",
    "state:5368709120",
  ]);
  assert.equal(
    (await readdir(f.root)).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("a concurrent edit during validation is not overwritten and creates no backup", async (t) => {
  const f = await fixture(t);
  const other = original + "ANOTHER_SETTING=operator-change\r\n";
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        health: async () => writeFile(f.envPath, other),
      },
    ),
    /changed concurrently/,
  );
  assert.equal(await readFile(f.envPath, "utf8"), other);
  assert.equal(f.calls.includes("reload"), false);
  assert.equal(
    (await readdir(f.root)).some((name) => name.endsWith(".bak")),
    false,
  );
});

test("a release change during validation stops before backup or replacement", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        health: async () => {
          f.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@invalid",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "changed release",
          );
        },
      },
    ),
    /exact expected release/,
  );
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.equal(f.calls.includes("reload"), false);
  assert.equal(
    (await readdir(f.root)).some((name) => name.endsWith(".bak")),
    false,
  );
});

test("the existing deployment lock excludes another configuration operation", async (t) => {
  const f = await fixture(t);
  let release;
  let entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = upgradeRecoveryLimits(f.options, {
    ...f.overrides,
    health: async () => {
      entered();
      await gate;
    },
  });
  await started;
  try {
    await assert.rejects(
      upgradeRecoveryLimits(f.options, f.overrides),
      /holds the deployment lock/,
    );
  } finally {
    release();
    await first;
  }
  assert.equal(await readFile(f.envPath, "utf8"), original);
});

test("failed reload restores exact bytes and reloads only after restoration", async (t) => {
  const f = await fixture(t);
  let reloads = 0;
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        reload: async () => {
          f.calls.push("reload");
          reloads++;
          const current = parseEnvText(await readFile(f.envPath, "utf8"));
          assert.equal(
            current.AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES,
            reloads === 1 ? "5368709120" : "134217728",
          );
          if (reloads === 1) throw new Error(sentinel);
        },
      },
    ),
    (error) => error.message.includes("rollback was verified") && !error.message.includes(sentinel),
  );
  assert.equal(reloads, 2);
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.deepEqual(f.calls, [
    "health",
    "state:134217728",
    "reload",
    "reload",
    "health",
    "state:134217728",
    "save",
    "state:134217728",
  ]);
});

test("a failed startup save restores, verifies and persists the original environment", async (t) => {
  const f = await fixture(t);
  let saves = 0;
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        persist: async () => {
          f.calls.push("save");
          if (++saves === 1) throw new Error(sentinel);
          assert.equal(await readFile(f.envPath, "utf8"), original);
        },
      },
    ),
    (error) =>
      error.message.includes("rollback was verified and saved for startup") &&
      !error.message.includes(sentinel),
  );
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.deepEqual(f.calls, [
    "health",
    "state:134217728",
    "reload",
    "health",
    "state:5368709120",
    "save",
    "reload",
    "health",
    "state:134217728",
    "save",
    "state:134217728",
  ]);
});

test("a failed rollback save never reports a fully verified rollback", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        persist: async () => {
          f.calls.push("save");
          throw new Error(sentinel);
        },
      },
    ),
    (error) =>
      error.message.includes("rollback could not be verified") && !error.message.includes(sentinel),
  );
  assert.equal(await readFile(f.envPath, "utf8"), original);
  assert.deepEqual(f.calls, [
    "health",
    "state:134217728",
    "reload",
    "health",
    "state:5368709120",
    "save",
    "reload",
    "health",
    "state:134217728",
    "save",
  ]);
});

test("post-reload health failure rolls back and verifies the original environment", async (t) => {
  const f = await fixture(t);
  let reloads = 0;
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        reload: async () => {
          reloads++;
        },
        health: async () => {
          if (reloads === 1) throw new Error("Wrong release/failed readiness");
        },
      },
    ),
    /rollback was verified/,
  );
  assert.equal(reloads, 2);
  assert.equal(await readFile(f.envPath, "utf8"), original);
});

test("rollback refuses to overwrite a later operator edit or reload it", async (t) => {
  const f = await fixture(t);
  let reloads = 0;
  const other = prepareEnvironment(original, parseEnvText).next + "OPERATOR_CHANGE=preserve\r\n";
  await assert.rejects(
    upgradeRecoveryLimits(
      { ...f.options, apply: true },
      {
        ...f.overrides,
        reload: async () => {
          reloads++;
          await writeFile(f.envPath, other);
          throw new Error(sentinel);
        },
      },
    ),
    /concurrent edit was not overwritten/,
  );
  assert.equal(reloads, 1);
  assert.equal(await readFile(f.envPath, "utf8"), other);
  const backup = (await readdir(f.root)).find((name) => name.endsWith(".bak"));
  assert.equal(await readFile(join(f.root, backup), "utf8"), original);
});

test("health requires exact API SHA plus a healthy worker on that same release", async () => {
  const sha = "c".repeat(40);
  const bodies = [
    { service: "ayin-api", status: "alive", releaseSha: sha },
    {
      service: "ayin-api",
      status: "ready",
      releaseSha: sha,
      checks: {
        database: { status: "ok" },
        configuration: { status: "ok" },
        worker: { status: "ok", releaseMatchesApi: true },
      },
    },
  ];
  const request =
    (mutate = (value) => value) =>
    async (url) =>
      new Response(JSON.stringify(mutate(structuredClone(bodies[url.endsWith("/ready") ? 1 : 0]))));
  await health(sha, request());
  await assert.rejects(
    health(
      sha,
      request((body) => ({ ...body, releaseSha: "d".repeat(40) })),
    ),
    /wrong release/,
  );
  await assert.rejects(
    health(
      sha,
      request((body) => {
        if (body.checks) body.checks.worker.status = "disabled";
        return body;
      }),
    ),
    /matching media worker/,
  );
});

test("PM2 verification checks exact services/settings; reload command never targets Web or other workers", async (t) => {
  const f = await fixture(t);
  const environment = prepareEnvironment(original, parseEnvText).overlay;
  const rows = ["ayin-api", "ayin-media-worker"].map((name) => ({
    name,
    pm2_env: {
      ...environment,
      status: "online",
      AYIN_RELEASE_SHA: f.expectedSha,
      pm_cwd: join(f.directory, "apps/api"),
    },
  }));
  await processState(f.directory, f.expectedSha, environment, async () => JSON.stringify(rows));
  rows[1].pm2_env.AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES = "134217728";
  await assert.rejects(
    processState(f.directory, f.expectedSha, environment, async () => JSON.stringify(rows)),
    /different upload settings/,
  );
  const commands = [];
  await reload(f.directory, f.envPath, f.expectedSha, async (...args) => {
    commands.push(args);
  });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(0, 2), [
    "pm2",
    [
      "reload",
      join(f.directory, "deploy/ecosystem.config.cjs"),
      "--only",
      "ayin-api,ayin-media-worker",
      "--update-env",
    ],
  ]);
  assert.equal(commands[0][2].env.AYIN_CURRENT_DIR, f.directory);
  assert.equal(commands[0][2].env.AYIN_API_ENV_FILE, f.envPath);
  await persist(async (...args) => {
    commands.push(args);
  });
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1], ["pm2", ["save"]]);
});
