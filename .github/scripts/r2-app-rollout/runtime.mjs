// Guarded AYIN configuration rollout. No browser credentials or provider mutation.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const SHA = "d29d539ae31b988714113b3a865ada9e996c5a8f";
const CURRENT = "/home/ayin/htdocs/current";
const ENV = "/home/ayin/env/api.env";
const JOURNAL = "/home/ayin/env/r2-app-rollout-20261013.json";
const BACKUP = "/home/ayin/env/r2-app-rollout-20261013.env.backup";
const prefix = "AYIN_UPLOAD_RECOVERY_";
const bounds = {
  AUDIENCE: "all",
  SOURCE_MAX_BYTES: "134217728",
  MAX_OUTSTANDING_SOURCES: "8",
  OUTPUT_ENVELOPE_BYTES: "536870912",
  DEBT_ACCOUNT_BYTES: "43486543872",
  DEBT_CHANNEL_BYTES: "43486543872",
};
const values = Object.fromEntries(
  Object.entries(bounds).map(([key, value]) => [prefix + key, value]),
);
const digest = (text) => createHash("sha256").update(text).digest("hex");
function check(condition, code = "GUARD_FAILED") {
  if (!condition) throw new Error(code);
}
export function validateActivation(env, counts, reserved) {
  check(
    env[prefix + "V2_ENABLED"] === "0" &&
      (env[prefix + "AUDIENCE"] ?? "canary") === "canary",
    "ISSUANCE_NOT_CLOSED",
  );
  check(
    counts.v2Sessions === 2 &&
      counts.unknownOperations === 0 &&
      counts.unacknowledgedWrites === 0 &&
      counts.pendingProcessing === 0 &&
      counts.pendingCleanup === 0,
    "BASELINE_NOT_SETTLED",
  );
  check(!reserved, "ACTIVATION_ALREADY_RESERVED");
}
export function patchEnv(text, values) {
  const keys = new Set(Object.keys(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const key = line
      .trim()
      .match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!keys.has(key)) return line;
    check(!seen.has(key), "DUPLICATE_SETTING");
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const key of keys)
    if (!seen.has(key)) lines.push(`${key}=${values[key]}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}

function privateFile(file) {
  const st = fs.lstatSync(file);
  check(
    st.isFile() &&
      !st.isSymbolicLink() &&
      st.uid === process.getuid() &&
      st.nlink === 1 &&
      (st.mode & 0o777) === 0o600 &&
      st.size < 1024 * 1024,
    "PRIVATE_FILE_GUARD",
  );
  return st;
}
function exclusive(file, text) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function replaceEnv(expected, text) {
  const before = privateFile(ENV);
  check(fs.readFileSync(ENV, "utf8") === expected, "ENV_CHANGED");
  const temp = `${ENV}.canary-${process.pid}-${Date.now()}`;
  exclusive(temp, text);
  const current = privateFile(ENV);
  check(
    current.ino === before.ino && fs.readFileSync(ENV, "utf8") === expected,
    "ENV_CHANGED",
  );
  fs.renameSync(temp, ENV);
  const dir = fs.openSync("/home/ayin/env", "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
function pm2Restart() {
  execFileSync(
    "pm2",
    [
      "restart",
      `${CURRENT}/deploy/ecosystem.config.cjs`,
      "--only",
      "ayin-api,ayin-media-worker",
      "--update-env",
    ],
    {
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  execFileSync("pm2", ["save"], {
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function live(name, expected) {
  const names = fs
    .readdirSync("/home/ayin/.pm2/pids")
    .filter((f) => new RegExp(`^${name}-[0-9]+\\.pid$`).test(f));
  check(names.length >= 1 && names.length <= 4, "PROCESS_COUNT");
  const matches = [];
  for (const name of names) {
    const pid = fs.readFileSync(`/home/ayin/.pm2/pids/${name}`, "utf8").trim();
    check(/^[1-9][0-9]*$/.test(pid), "PID_INVALID");
    let raw;
    try {
      raw = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
    } catch {
      continue;
    }
    check(raw.length <= 1024 * 1024, "ENV_TOO_LARGE");
    const env = Object.fromEntries(
      raw
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    check(env.AYIN_RELEASE_SHA === SHA, "LIVE_RELEASE_CHANGED");
    for (const [key, value] of Object.entries(expected))
      check(env[key] === value, "LIVE_CONFIG_MISMATCH");
    matches.push({ pid: Number(pid), env });
  }
  check(matches.length === 1, "LIVE_PROCESS_COUNT");
  return matches[0];
}
async function healthy() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await fetch("http://127.0.0.1:4000/health/ready", {
        redirect: "error",
        signal: AbortSignal.timeout(2000),
      });
      const data = await r.json();
      if (
        r.status === 200 &&
        data.status === "ready" &&
        data.releaseSha === SHA
      )
        return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("HEALTH_FAILED");
}

async function execute(mode) {
  const output = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write = () => true;
  let client,
    currentText,
    changed = false;
  const report = {
    mode,
    releaseSha: SHA,
    providerRequests: 0,
    databaseWrites: 0,
    deletions: 0,
  };
  try {
    check(
      ["enable", "inspect", "disable", "verify"].includes(mode),
      "MODE_INVALID",
    );
    check(
      process.env.USER === "ayin" && process.env.HOME === "/home/ayin",
      "HOST_IDENTITY",
    );
    const root = fs.realpathSync(CURRENT);
    check(root.startsWith("/home/ayin/htdocs/releases/"), "RELEASE_PATH");
    check(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        timeout: 2000,
      }).trim() === SHA,
      "RELEASE_CHANGED",
    );
    privateFile(ENV);
    currentText = fs.readFileSync(ENV, "utf8");
    const { parseEnvText } = createRequire(`${root}/deploy/env-file.cjs`)(
      `${root}/deploy/env-file.cjs`,
    );
    const env = parseEnvText(currentText);
    const moduleAt = (rel) =>
      import(pathToFileURL(`${root}/apps/api/dist/${rel}.js`).href);
    const [{ loadMediaStorageConfig }, rollout] = await Promise.all([
      moduleAt("media/media-storage.config"),
      moduleAt("media/media-upload-rollout"),
    ]);
    const config = loadMediaStorageConfig({
      ...env,
      ...values,
      [prefix + "V2_ENABLED"]: "1",
    });
    check(
      config.mode === "r2" &&
        config.partSizeBytes === 16777216 &&
        rollout.configuredUploadRecovery(config),
      "ROLLOUT_POLICY_INVALID",
    );
    await healthy();
    const { Client } = createRequire(`${root}/packages/db/package.json`)("pg");
    client = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      statement_timeout: 4000,
      query_timeout: 5000,
      options: "-c default_transaction_read_only=on",
      application_name: "ayin-upload-rollout-readback",
    });
    await client.connect();
    const counts = (
      await client.query(`SELECT
      (SELECT COUNT(*)::int FROM "MediaUploadSession" WHERE "sourceProtocolVersion"=2) AS "v2Sessions",
      (SELECT COUNT(*)::int FROM "MediaUploadOperation" o JOIN "MediaUploadSession" s ON s.id=o."sessionId" WHERE s."sourceProtocolVersion"=2 AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN') AS "unknownOperations",
      (SELECT COUNT(*)::int FROM "MediaProcessingOutputWrite" WHERE status <> 'ACKNOWLEDGED') AS "unacknowledgedWrites",
      (SELECT COUNT(*)::int FROM "MediaProcessingJob" WHERE "outputProtocolVersion"=2 AND status NOT IN ('READY','CANCELLED')) AS "pendingProcessing",
      (SELECT COUNT(*)::int FROM "PrivacyMediaDeletionJob" WHERE "cleanupContractVersion"=2 AND status <> 'DONE') AS "pendingCleanup"`)
    ).rows[0];
    Object.assign(report, counts);
    const originals = (
      await client.query(
        `SELECT id FROM "MediaUploadSession" WHERE "sourceProtocolVersion"=2 ORDER BY "createdAt" LIMIT 2`,
      )
    ).rows
      .map((r) => digest(r.id))
      .sort();
    check(
      JSON.stringify(originals) ===
        JSON.stringify(
          [
            "d88f09decfb9c8be70902626236a92dec4578ee52d6b778f85b6ca2ab59868fc",
            "617d3eedbeaba057c4685e1c504871598c9e8899317585305c3d0927a108773b",
          ].sort(),
        ),
      "PREDECESSOR_SESSIONS_CHANGED",
    );
    if (mode === "enable") {
      validateActivation(
        env,
        counts,
        fs.existsSync(JOURNAL) || fs.existsSync(BACKUP),
      );
      live("ayin-api", { [prefix + "V2_ENABLED"]: "0" });
      live("ayin-media-worker", { [prefix + "V2_ENABLED"]: "0" });
      const next = patchEnv(currentText, {
        ...values,
        [prefix + "V2_ENABLED"]: "1",
      });
      exclusive(BACKUP, currentText);
      exclusive(
        JOURNAL,
        JSON.stringify(
          {
            releaseSha: SHA,
            createdAt: new Date().toISOString(),
            originalEnvSha256: digest(currentText),
            enabledEnvSha256: digest(next),
            bounds,
          },
          null,
          2,
        ) + "\n",
      );
      replaceEnv(currentText, next);
      currentText = next;
      changed = true;
      pm2Restart();
      await healthy();
    } else if (mode === "disable") {
      privateFile(JOURNAL);
      check(
        JSON.parse(fs.readFileSync(JOURNAL, "utf8")).releaseSha === SHA,
        "ACTIVATION_JOURNAL_CHANGED",
      );
      const next = patchEnv(currentText, { [prefix + "V2_ENABLED"]: "0" });
      replaceEnv(currentText, next);
      currentText = next;
      changed = true;
      pm2Restart();
      await healthy();
    }
    const actual = parseEnvText(fs.readFileSync(ENV, "utf8"));
    if (mode !== "inspect" || actual[prefix + "AUDIENCE"] === "all")
      for (const [key, value] of Object.entries(values))
        check(actual[key] === value, "CONFIG_CHANGED");
    const expected = Object.fromEntries(
      Object.keys(values)
        .filter((k) => actual[k] !== undefined)
        .map((k) => [k, actual[k]]),
    );
    expected[prefix + "V2_ENABLED"] = actual[prefix + "V2_ENABLED"];
    live("ayin-api", expected);
    live("ayin-media-worker", expected);
    report.issuanceEnabled = actual[prefix + "V2_ENABLED"] === "1";
    report.allCreators = actual[prefix + "AUDIENCE"] === "all";
    report.sourceMaxBytes = Number(actual[prefix + "SOURCE_MAX_BYTES"] ?? 0);
    report.maximumSources = Number(
      actual[prefix + "MAX_OUTSTANDING_SOURCES"] ?? 1,
    );
    report.outputEnvelopeBytes = Number(
      actual[prefix + "OUTPUT_ENVELOPE_BYTES"] ?? 0,
    );
    report.debtBudgetBytes = Number(actual[prefix + "DEBT_ACCOUNT_BYTES"] ?? 0);
    const fixtures = (
      await client.query(
        `SELECT s.id,s.state,s."sizeBytes"::text AS "sourceBytes",s."grantReservationCount",s."providerExposureBytes"::text AS "sourceExposureBytes",s."objectKey",s."providerUploadId",j.status AS "jobStatus",j."inputIntegrityDigest",j."outputIntegrityDigest",j."outputR2ObjectKey",j."outputIntegritySizeBytes"::text AS "outputBytes",j."inputVerifiedAt",j."outputVerifiedAt",a."thumbnailR2ObjectKey",
      (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='CREATE') AS "createOperations",
      (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='COMPLETE') AS "completeOperations",
      (SELECT COUNT(*)::int FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id AND d.status='DONE') AS "sourceCleanupDone",
      (SELECT COUNT(*)::int FROM "MediaProcessingOutputReservation" r WHERE r."uploadSessionId"=s.id) AS "outputReservations"
      FROM "MediaUploadSession" s JOIN "Channel" c ON c.id=s."channelId"
      LEFT JOIN "MediaProcessingJob" j ON j."inputIntegritySessionId"=s.id
      LEFT JOIN "MediaProcessingOutputAttempt" a ON a.id=j."currentOutputAttemptId"
      WHERE c.handle='mr-lord' AND s."sourceProtocolVersion"=2 AND s."sizeBytes"=67109001 AND (s."contentIdentityDigest"=$1 OR j."inputIntegrityDigest"=$1)`,
        ["ada7a437a1d9d70021cee510add19c3adfe0718f1c5ca1127bfd7cb710c6e3a3"],
      )
    ).rows;
    report.fixtureCount = fixtures.length;
    if (fixtures.length === 1) {
      const f = fixtures[0];
      const cleanup = (
        await client.query(
          `SELECT
            COUNT(*)::int AS "cleanupTotal",
            COUNT(*) FILTER (WHERE status='DONE')::int AS "cleanupDone",
            COUNT(*) FILTER (WHERE status='FAILED')::int AS "cleanupFailed",
            COUNT(*) FILTER (WHERE status <> 'DONE' AND "lastObservation"='GRANT_CUTOFF_PENDING')::int AS "cleanupWaitingForGrant",
            COALESCE(MAX(attempts),0)::int AS "cleanupMaxAttempts",
            COUNT(*) FILTER (WHERE "debtKind" IS NOT NULL AND status <> 'DONE')::int AS "cleanupDebt",
            COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN("availableAt") FILTER (WHERE status <> 'DONE') - clock_timestamp()))),0)::int AS "nextCleanupSeconds"
          FROM "PrivacyMediaDeletionJob" WHERE "uploadSessionId"=$1`,
          [f.id],
        )
      ).rows[0];
      Object.assign(report, cleanup);
      const grant = (
        await client.query(
          `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("lastGrantExpiresAt" - clock_timestamp()))))::int AS "grantCutoffSeconds",
            "contentIdentityDigest" IS NULL AS "sourceIdentityRetired"
          FROM "MediaUploadSession" WHERE id=$1`,
          [f.id],
        )
      ).rows[0];
      Object.assign(report, grant);
      report.fixtureFingerprint = digest(f.id);
      report.fixtureState = f.state;
      report.fixtureJobStatus = f.jobStatus ?? "NONE";
      for (const key of [
        "sourceBytes",
        "grantReservationCount",
        "sourceExposureBytes",
        "createOperations",
        "completeOperations",
        "sourceCleanupDone",
        "outputReservations",
      ])
        report[key] = Number(f[key]);
      if (mode === "verify") {
        check(
          f.state === "COMPLETED" &&
            f.jobStatus === "READY" &&
            f.inputVerifiedAt &&
            f.outputVerifiedAt &&
            f.createOperations === 1 &&
            f.completeOperations === 1 &&
            f.outputReservations === 1,
          "FIXTURE_NOT_READY",
        );
        check(
          counts.unknownOperations === 0 && counts.unacknowledgedWrites === 0,
          "UNKNOWN_EFFECTS_PRESENT",
        );
        const { R2MediaStorageAdapter } = await moduleAt(
          "media/r2-media-storage.adapter",
        );
        const { R2HttpError } = await moduleAt("media/r2-sigv4");
        const { hashUploadFileIdentity } = await import(
          pathToFileURL(`${root}/packages/types/dist/upload-file-identity.js`)
            .href
        );
        const adapter = new R2MediaStorageAdapter(
          loadMediaStorageConfig(actual),
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
          check(
            ["GET", "HEAD"].includes(init?.method) &&
              report.providerRequests < 4,
            "READ_ONLY_PROVIDER_LIMIT",
          );
          report.providerRequests++;
          return originalFetch(url, {
            ...init,
            signal: AbortSignal.timeout(15000),
          });
        };
        try {
          const bytes = await adapter.readObject(f.outputR2ObjectKey, 33554432);
          const identity = await hashUploadFileIdentity(
            (async function* () {
              yield bytes;
            })(),
            bytes.length,
          );
          check(
            identity.rootSha256 === f.outputIntegrityDigest &&
              bytes.length === Number(f.outputBytes),
            "OUTPUT_MISMATCH",
          );
          report.outputReadbackMatches = true;
          report.outputBytes = bytes.length;
          report.outputSha256 = digest(bytes);
          const thumbnail = await adapter.headObject(f.thumbnailR2ObjectKey);
          report.thumbnailBytes = thumbnail.sizeBytes;
          try {
            await adapter.headObject(f.objectKey);
            report.sourceAbsent = false;
          } catch (error) {
            check(
              error instanceof R2HttpError && error.status === 404,
              "SOURCE_OBSERVATION_FAILED",
            );
            report.sourceAbsent = true;
          }
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
    } else check(mode !== "verify", "EXACT_FIXTURE_REQUIRED");
    report.status = "VERIFIED";
  } catch (error) {
    report.status = "FAILED";
    report.code = /^[A-Z0-9_]{1,70}$/.test(error.message)
      ? error.message
      : "REDACTED";
    if (changed && mode === "enable")
      try {
        const current = fs.readFileSync(ENV, "utf8");
        replaceEnv(
          current,
          patchEnv(current, { [prefix + "V2_ENABLED"]: "0" }),
        );
        pm2Restart();
        await healthy();
        report.issuanceDisabledAfterFailure = true;
      } catch {
        report.issuanceDisabledAfterFailure = false;
      }
    process.exitCode = 2;
  } finally {
    try {
      await client?.end();
    } catch {}
    output(JSON.stringify(report) + "\n");
  }
}
if (process.argv[1] === "-") await execute(process.argv[2]);
