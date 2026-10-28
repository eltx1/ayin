#!/usr/bin/env node
// Run only after the intended release is healthy. Dry-run is the default.
import { constants } from "node:fs";
import { open, realpath, rename, unlink } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const production = {
  currentDir: "/home/ayin/htdocs/current",
  envPath: "/home/ayin/env/api.env",
  lockPath: "/home/ayin/.deploy.lock",
};
export const changes = Object.freeze({
  AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES: ["134217728", "5368709120"],
  AYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES: ["536870912", "17179869184"],
  AYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES: ["43486543872", "1735166787584"],
  AYIN_UPLOAD_RECOVERY_DEBT_CHANNEL_BYTES: ["43486543872", "1735166787584"],
});
const required = {
  AYIN_UPLOAD_RECOVERY_V2_ENABLED: "1",
  AYIN_UPLOAD_RECOVERY_AUDIENCE: "all",
  AYIN_UPLOAD_RECOVERY_MAX_OUTSTANDING_SOURCES: "8",
};
const services = ["ayin-api", "ayin-media-worker"];

class GuardError extends Error {}
function guard(condition, message) {
  if (!condition) throw new GuardError(message);
}
async function command(program, args, options = {}) {
  try {
    return (await exec(program, args, { timeout: 15000, maxBuffer: 8 * 1024 ** 2, ...options }))
      .stdout;
  } catch {
    // PM2/git stderr or child exceptions may contain environment data.
    throw new GuardError("A required local process command failed; its output was withheld.");
  }
}

export function parseArguments(args) {
  guard(
    args.length >= 1 && args.length <= 2 && /^[a-f0-9]{40}$/i.test(args[0] ?? ""),
    "Usage: node upgrade-recovery-limits.mjs <exact-40-character-release-sha> [--apply]",
  );
  guard(
    args.length === 1 || args[1] === "--apply",
    "Only the explicit --apply option is supported.",
  );
  return { expectedSha: args[0].toLowerCase(), apply: args[1] === "--apply" };
}

export function prepareEnvironment(text, parseEnvText) {
  let environment;
  try {
    environment = parseEnvText(text, "private API environment");
  } catch {
    throw new GuardError("The private API environment could not be parsed.");
  }
  for (const [key, value] of Object.entries(required))
    guard(
      environment[key] === value,
      "Existing recovery audience, enablement or outstanding-source guard does not match.",
    );
  const keys = new Set([...Object.keys(changes), ...Object.keys(required)]);
  const counts = new Map();
  const lines = text.split(/(?<=\n)/);
  const next = lines
    .map((line) => {
      const match = line.match(
        /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)([^\r\n]*)(\r?\n)?$/,
      );
      if (!match || !keys.has(match[2])) return line;
      counts.set(match[2], (counts.get(match[2]) ?? 0) + 1);
      const change = changes[match[2]];
      if (!change) return line;
      guard(
        environment[match[2]] === change[0],
        "An upload setting is absent or differs from the exact expected old value.",
      );
      const leading = match[3].match(/^\s*/)?.[0] ?? "";
      const trailing = match[3].match(/\s*$/)?.[0] ?? "";
      const trimmed = match[3].trim();
      const quote = trimmed.startsWith('"') ? '"' : trimmed.startsWith("'") ? "'" : "";
      return `${match[1]}${leading}${quote}${change[1]}${quote}${trailing}${match[4] ?? ""}`;
    })
    .join("");
  for (const key of keys)
    guard(counts.get(key) === 1, "Each guarded upload setting must occur exactly once.");
  let overlay;
  try {
    overlay = parseEnvText(next, "proposed private API environment");
  } catch {
    throw new GuardError("The proposed API environment could not be parsed.");
  }
  guard(
    Object.keys(overlay).length === Object.keys(environment).length,
    "The proposed environment changed its key set.",
  );
  for (const [key, value] of Object.entries(environment))
    guard(
      overlay[key] === (changes[key]?.[1] ?? value),
      "The proposed environment changed an unrelated setting.",
    );
  return { next, environment, overlay };
}

async function snapshot(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    guard(
      stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0,
      "The API environment must be a private regular file without extra hard links.",
    );
    return { bytes: await handle.readFile(), uid: stat.uid, gid: stat.gid };
  } finally {
    await handle.close();
  }
}
async function assertUnchanged(path, expected) {
  guard(
    (await snapshot(path)).bytes.equals(expected),
    "The API environment changed concurrently; refusing to overwrite it.",
  );
}
async function privateWrite(path, bytes, owner) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chown(owner.uid, owner.gid);
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path) {
  const handle = await open(dirname(path), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function replaceEnvironment(path, bytes, owner, expected) {
  const temporary = `${path}.recovery-${randomUUID()}.tmp`;
  try {
    await privateWrite(temporary, bytes, owner);
    await assertUnchanged(path, expected);
    await rename(temporary, path);
    await syncDirectory(path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function releaseDirectory(currentDir, expectedSha) {
  const directory = await realpath(currentDir);
  const actual = (await command("git", ["-C", directory, "rev-parse", "--verify", "HEAD"])).trim();
  guard(actual === expectedSha, "The current deployment is not the exact expected release.");
  return directory;
}
async function validators(directory) {
  try {
    const [{ parseEnvText }, { loadMediaStorageConfig }, { configuredUploadRecovery }] =
      await Promise.all([
        import(pathToFileURL(join(directory, "deploy/env-file.cjs")).href),
        import(pathToFileURL(join(directory, "apps/api/dist/media/media-storage.config.js")).href),
        import(pathToFileURL(join(directory, "apps/api/dist/media/media-upload-rollout.js")).href),
      ]);
    return {
      parseEnvText,
      validate(environment) {
        const config = loadMediaStorageConfig({
          ...environment,
          APP_ENV: "production",
          NODE_ENV: "production",
        });
        const scope = configuredUploadRecovery(config);
        guard(
          config.appEnv === "production" &&
            config.mode === "r2" &&
            config.recoveryV2Enabled === true &&
            config.recoveryAudience === "all" &&
            config.recoveryMaxOutstandingSources === 8 &&
            config.recoveryDebtAccountBytes ===
              Number(changes.AYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES[1]) &&
            config.recoveryDebtChannelBytes ===
              Number(changes.AYIN_UPLOAD_RECOVERY_DEBT_CHANNEL_BYTES[1]) &&
            scope?.sourceMaxBytes === Number(changes.AYIN_UPLOAD_RECOVERY_SOURCE_MAX_BYTES[1]) &&
            scope?.outputEnvelopeBytes ===
              Number(changes.AYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES[1]),
          "The deployed compiled recovery policy did not accept the exact proposed limits.",
        );
      },
    };
  } catch {
    throw new GuardError("The deployed compiled configuration validators could not be loaded.");
  }
}
export async function health(expectedSha, request = fetch) {
  for (const [path, status] of [
    ["health", "alive"],
    ["ready", "ready"],
  ]) {
    const response = await request(`http://127.0.0.1:4000/${path}`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    guard(response.ok, "API health or readiness did not succeed.");
    const body = await response.json();
    guard(
      body.service === "ayin-api" && body.status === status && body.releaseSha === expectedSha,
      "API health or readiness reported the wrong release.",
    );
    if (path === "ready")
      guard(
        body.checks?.database?.status === "ok" &&
          body.checks?.configuration?.status === "ok" &&
          body.checks?.worker?.status === "ok" &&
          body.checks?.worker?.releaseMatchesApi === true,
        "Readiness did not confirm the database, configuration and matching media worker.",
      );
  }
}
export async function processState(directory, expectedSha, environment, run = command) {
  let rows;
  try {
    rows = JSON.parse(await run("pm2", ["jlist"]));
  } catch {
    throw new GuardError("PM2 process state could not be read safely.");
  }
  for (const name of services) {
    const matches = rows.filter((row) => row.name === name);
    guard(matches.length === 1, "Exactly one API and one media worker process are required.");
    const state = matches[0].pm2_env;
    guard(
      state?.status === "online" &&
        state.AYIN_RELEASE_SHA === expectedSha &&
        (await realpath(state.pm_cwd)) === join(directory, "apps/api"),
      "An API or media worker process is not online on the exact expected release.",
    );
    for (const key of [...Object.keys(changes), ...Object.keys(required)])
      guard(
        state[key] === environment[key],
        "An API or media worker process has different upload settings.",
      );
  }
}
export async function reload(directory, envPath, expectedSha, run = command) {
  await run(
    "pm2",
    [
      "reload",
      join(directory, "deploy/ecosystem.config.cjs"),
      "--only",
      services.join(","),
      "--update-env",
    ],
    {
      cwd: directory,
      timeout: 360000,
      env: {
        ...process.env,
        AYIN_CURRENT_DIR: directory,
        AYIN_API_ENV_FILE: envPath,
        AYIN_RELEASE_SHA: expectedSha,
      },
    },
  );
}
export async function persist(run = command) {
  // Use the same PM2 account as the verified processes. This saves startup
  // state without restarting any additional services; captured output is private.
  await run("pm2", ["save"]);
}
async function acquireLock(path) {
  const child = spawn(
    "flock",
    [
      "--nonblock",
      path,
      process.execPath,
      "-e",
      'process.stdout.write("locked\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  child.stdin.on("error", () => {});
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(new GuardError("The deployment lock could not be acquired.")));
    child.once("exit", () =>
      reject(
        new GuardError("Another deployment or configuration change holds the deployment lock."),
      ),
    );
    child.stdout.once("data", (data) =>
      data.toString() === "locked\n"
        ? resolve()
        : reject(new GuardError("The deployment lock handshake failed.")),
    );
  });
  return {
    assertHeld() {
      guard(
        child.exitCode === null && child.signalCode === null && !child.killed,
        "The deployment lock was lost.",
      );
    },
    async release() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.stdin.end();
      await closed;
    },
  };
}

// Paths/dependencies are injectable only through this exported function for fixture
// tests. The operator CLI always uses the fixed production paths above.
export async function upgradeRecoveryLimits(options, overrides = {}) {
  const settings = { ...production, apply: false, ...options };
  guard(
    /^[a-f0-9]{40}$/.test(settings.expectedSha ?? ""),
    "An exact lowercase 40-character release SHA is required.",
  );
  const operations = {
    releaseDirectory,
    validators,
    health,
    processState,
    reload,
    persist,
    delay: () => new Promise((resolve) => setTimeout(resolve, 2000)),
    healthAttempts: 30,
    ...overrides,
  };
  const lock = await acquireLock(settings.lockPath);
  let backupPath = null;
  try {
    const directory = await operations.releaseDirectory(settings.currentDir, settings.expectedSha);
    const original = await snapshot(settings.envPath);
    guard(
      Buffer.from(original.bytes.toString("utf8")).equals(original.bytes),
      "The API environment is not valid UTF-8 text.",
    );
    const modules = await operations.validators(directory);
    const proposed = prepareEnvironment(original.bytes.toString("utf8"), modules.parseEnvText);
    try {
      modules.validate(proposed.overlay);
    } catch {
      throw new GuardError(
        "The compiled production configuration rejected the proposed upload limits.",
      );
    }
    await operations.health(settings.expectedSha);
    await operations.processState(directory, settings.expectedSha, proposed.environment);
    await assertUnchanged(settings.envPath, original.bytes);
    guard(
      (await operations.releaseDirectory(settings.currentDir, settings.expectedSha)) === directory,
      "The current release changed during validation.",
    );
    lock.assertHeld();
    if (!settings.apply)
      return { status: "dry-run", releaseSha: settings.expectedSha, changedKeys: 4 };

    backupPath = `${settings.envPath}.before-recovery-upgrade-${randomUUID()}.bak`;
    await privateWrite(backupPath, original.bytes, original);
    await syncDirectory(backupPath);
    const replacement = Buffer.from(proposed.next);
    const verify = async (environment) => {
      for (let attempt = 0; attempt < operations.healthAttempts; attempt++) {
        try {
          lock.assertHeld();
          guard(
            (await operations.releaseDirectory(settings.currentDir, settings.expectedSha)) ===
              directory,
            "The release changed during verification.",
          );
          await operations.health(settings.expectedSha);
          await operations.processState(directory, settings.expectedSha, environment);
          return;
        } catch {
          if (attempt + 1 < operations.healthAttempts) await operations.delay();
        }
      }
      throw new GuardError(
        "API/media worker verification did not recover on the exact expected release.",
      );
    };
    let reloadStarted = false;
    try {
      lock.assertHeld();
      // Replacement checks original bytes again immediately before rename.
      await replaceEnvironment(settings.envPath, replacement, original, original.bytes);
      reloadStarted = true;
      await operations.reload(directory, settings.envPath, settings.expectedSha);
      await verify(proposed.overlay);
      await assertUnchanged(settings.envPath, replacement);
      await operations.persist();
      await operations.processState(directory, settings.expectedSha, proposed.overlay);
      await assertUnchanged(settings.envPath, replacement);
      return { status: "applied", releaseSha: settings.expectedSha, changedKeys: 4, backupPath };
    } catch {
      let current;
      try {
        current = (await snapshot(settings.envPath)).bytes;
      } catch {
        throw new GuardError(
          `Upgrade failed; the environment could not be safely inspected for rollback. Private backup: ${backupPath}`,
        );
      }
      if (!current.equals(replacement) && !current.equals(original.bytes))
        throw new GuardError(
          `Upgrade failed; a concurrent edit was not overwritten. Private backup: ${backupPath}`,
        );
      if (current.equals(original.bytes) && !reloadStarted)
        throw new GuardError(
          `Upgrade stopped before changing the environment or services. Private backup: ${backupPath}`,
        );
      try {
        lock.assertHeld();
        if (current.equals(replacement))
          await replaceEnvironment(settings.envPath, original.bytes, original, replacement);
        guard(
          (await operations.releaseDirectory(settings.currentDir, settings.expectedSha)) ===
            directory,
          "The release changed before rollback reload.",
        );
        await operations.reload(directory, settings.envPath, settings.expectedSha);
        await verify(proposed.environment);
        await assertUnchanged(settings.envPath, original.bytes);
        await operations.persist();
        await operations.processState(directory, settings.expectedSha, proposed.environment);
        await assertUnchanged(settings.envPath, original.bytes);
      } catch {
        throw new GuardError(
          `Upgrade failed and rollback could not be verified. Later edits were not overwritten; inspect service state. Private backup: ${backupPath}`,
        );
      }
      throw new GuardError(
        "Upgrade failed; the original environment was restored and API/media worker rollback was verified and saved for startup.",
      );
    }
  } finally {
    await lock.release();
  }
}

// The production "current" directory is a symlink; resolve both entry paths.
if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => null)) ===
    (await realpath(fileURLToPath(import.meta.url)))
) {
  process.umask(0o077);
  try {
    const result = await upgradeRecoveryLimits(parseArguments(process.argv.slice(2)));
    console.log(
      result.status === "dry-run"
        ? "Dry-run passed: four upload settings validated. No environment or service was changed."
        : "Upgrade passed: four upload settings applied; API and media worker verified on the exact release and saved for startup.",
    );
    if (result.backupPath) console.log(`Private rollback backup: ${result.backupPath}`);
  } catch (error) {
    console.error(
      error instanceof GuardError
        ? error.message
        : "The guarded configuration upgrade failed; diagnostic output was withheld.",
    );
    process.exitCode = 1;
  }
}
