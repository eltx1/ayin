// One approved account/channel only. No provider calls, application writes, or deletion.
// Run on the existing AYIN host under its deployment lock; never locally in execute mode.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA = "ab8355f3c45e5208ef9fe6477666b8f834c231b4";
const EMAIL_HASH = "cf5d0dadb387594ca389641b3f17371712c6d27dca8e0a33e2e6c0f3177beb6d";
const CURRENT = "/home/ayin/htdocs/current";
const ENV = "/home/ayin/env/api.env";
const JOURNAL = "/home/ayin/env/r2-app-canary-20261010.json";
const BACKUP = "/home/ayin/env/r2-app-canary-20261010.env.backup";
const RESUME_JOURNAL = "/home/ayin/env/r2-app-canary-20261010.resume-1.json";
const prefix = "AYIN_UPLOAD_RECOVERY_";
const bounds = {
  CANARY_SOURCE_MAX_BYTES: "1048576",
  OUTPUT_ENVELOPE_BYTES: "33554432",
  DEBT_ACCOUNT_BYTES: "5402263552",
  DEBT_CHANNEL_BYTES: "5402263552",
};
const digest = (text) => createHash("sha256").update(text).digest("hex");
function check(condition, code = "GUARD_FAILED") {
  if (!condition) throw new Error(code);
}
export function patchEnv(text, values) {
  const keys = new Set(Object.keys(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const key = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!keys.has(key)) return line;
    check(!seen.has(key), "DUPLICATE_SETTING");
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const key of keys) if (!seen.has(key)) lines.push(`${key}=${values[key]}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}
export function validateResume(journal, backupText, currentText, values, exists) {
  check(!exists, "RESUME_ALREADY_RESERVED");
  check(journal.releaseSha === SHA && journal.cleanupApproved === false, "PREDECESSOR_INVALID");
  check(
    journal.accountId === values[prefix + "CANARY_ACCOUNT_ID"] &&
      journal.channelId === values[prefix + "CANARY_CHANNEL_ID"],
    "PREDECESSOR_SCOPE",
  );
  check(
    Object.entries(bounds).every(([key, value]) => journal.approvedBounds?.[key] === value),
    "PREDECESSOR_BOUNDS",
  );
  check(
    journal.fixtureBytes === 478196 &&
      journal.fixtureSha256 === "184bb9e5d9ad3218af8c4f4552558c24c506d166c293dbbc83becd810e4db98c",
    "PREDECESSOR_FIXTURE",
  );
  check(digest(backupText) === journal.originalEnvSha256, "BACKUP_CHANGED");
  const enabled = patchEnv(backupText, values);
  check(digest(enabled) === journal.enabledEnvSha256, "PREDECESSOR_CONFIG");
  check(currentText === patchEnv(enabled, { [prefix + "V2_ENABLED"]: "0" }), "CLOSURE_CHANGED");
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
  check(current.ino === before.ino && fs.readFileSync(ENV, "utf8") === expected, "ENV_CHANGED");
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
    { timeout: 90000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  execFileSync("pm2", ["save"], { timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
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
      if (r.status === 200 && data.status === "ready" && data.releaseSha === SHA) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("HEALTH_FAILED");
}

async function execute(mode) {
  const output = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write = () => true;
  let stage = "PREFLIGHT",
    changed = false,
    currentText,
    values,
    predecessorText,
    verifiedFixture,
    providerEnv,
    client;
  const report = { mode, releaseSha: SHA, providerRequests: 0, deletions: 0, databaseWrites: 0 };
  try {
    check(["enable", "resume", "disable", "inspect", "verify"].includes(mode), "MODE_INVALID");
    check(process.env.USER === "ayin" && process.env.HOME === "/home/ayin", "HOST_IDENTITY");
    const root = fs.realpathSync(CURRENT);
    check(root.startsWith("/home/ayin/htdocs/releases/"), "RELEASE_PATH");
    check(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim() === SHA,
      "RELEASE_CHANGED",
    );
    privateFile(ENV);
    currentText = fs.readFileSync(ENV, "utf8");
    const require = createRequire(`${root}/deploy/env-file.cjs`);
    const { parseEnvText } = require(`${root}/deploy/env-file.cjs`);
    const env = parseEnvText(currentText);
    providerEnv = env;
    const moduleAt = (rel) => import(pathToFileURL(`${root}/apps/api/dist/${rel}.js`).href);
    const [{ loadMediaStorageConfig }, canary, admission, { platformSettingCatalog: catalog }] =
      await Promise.all([
        moduleAt("media/media-storage.config"),
        moduleAt("media/media-upload-canary"),
        moduleAt("media/media-upload-admission"),
        moduleAt("platform-config/platform-settings.catalog"),
      ]);
    check(loadMediaStorageConfig(env).mode === "r2", "R2_NOT_CONFIGURED");
    check(Number(env.R2_PART_SIZE_BYTES) === 16777216, "PART_SIZE_CHANGED");
    check(await healthy(), "UNHEALTHY");
    const dbRequire = createRequire(`${root}/packages/db/package.json`);
    const { Client, types } = dbRequire("pg");
    types.setTypeParser(20, (value) => BigInt(value));
    client = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      statement_timeout: 4000,
      query_timeout: 5000,
      options: "-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=15000",
      application_name: "ayin-approved-canary-scope",
    });
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const owners = (
      await client.query(`SELECT a.id AS "accountId", a.email, c.id AS "channelId"
      FROM "Channel" c JOIN "ChannelMember" m ON m."channelId"=c.id
      JOIN "Account" a ON a.id=m."accountId" WHERE c.handle='mr-lord'
      AND c.status='ACTIVE' AND c."removedAt" IS NULL AND m.role='OWNER'
      AND a.status='ACTIVE' AND a."closedAt" IS NULL`)
    ).rows;
    const owner = owners.filter((row) => digest(row.email.trim().toLowerCase()) === EMAIL_HASH);
    check(owner.length === 1, "EXACT_OWNER_NOT_FOUND");
    const { accountId, channelId } = owner[0];
    values = Object.fromEntries(
      Object.entries({
        V2_ENABLED: ["enable", "resume"].includes(mode) ? "1" : "0",
        CANARY_ACCOUNT_ID: accountId,
        CANARY_CHANNEL_ID: channelId,
        ...bounds,
      }).map(([key, value]) => [prefix + key, value]),
    );
    const config = loadMediaStorageConfig({ ...env, ...values });
    check(canary.configuredUploadCanary(config), "CANARY_BOUNDS_INVALID");
    report.exactOwnerMatched = true;
    report.sourceMaxBytes = config.recoveryCanarySourceMaxBytes;
    report.outputEnvelopeBytes = config.recoveryOutputEnvelopeBytes;
    report.debtBudgetBytes = config.recoveryDebtAccountBytes;
    report.partSizeBytes = config.partSizeBytes;
    const settings = (
      await client.query(
        `SELECT key, "schemaVersion", "valueType", value FROM
      "PlatformSetting" WHERE namespace='UPLOAD' AND key=ANY($1::text[])`,
        [
          [
            "uploadChannelQuotaBytes",
            "uploadMaxSizeBytes",
            "mediaProcessingEnabled",
            "mediaHlsEnabled",
            "mediaHlsNewUploadsEnabled",
          ],
        ],
      )
    ).rows;
    const setting = (key) => {
      const def = catalog[key],
        row = settings.find((r) => r.key === key);
      const parsed =
        row?.schemaVersion === 1 && row.valueType === def.valueType
          ? def.schema.safeParse(row.value)
          : null;
      return parsed?.success ? parsed.data : def.defaultValue;
    };
    const readTx = {
      $queryRaw: async (strings, ...params) => {
        check(Array.isArray(strings) && strings.raw, "QUERY_INVALID");
        const sql = strings.reduce((q, part, i) => q + (i ? `$${i}` : "") + part, "");
        check(
          /^\s*(SELECT|WITH)\b/.test(sql) &&
            !/\b(INSERT|UPDATE|DELETE|CALL|COPY|pg_\w*lock)\b/i.test(sql),
          "READ_ONLY_QUERY_REQUIRED",
        );
        const rows = (await client.query(sql, params)).rows;
        if (rows.length === 1) {
          for (const key of [
            "activeAccount",
            "activeChannel",
            "retainedDebtAccount",
            "retainedDebtChannel",
            "uncertainAccount",
            "uncertainChannel",
            "accountBytes",
            "channelBytes",
            "unaccounted",
          ])
            if (typeof rows[0][key] === "bigint") {
              check(Number.isSafeInteger(Number(rows[0][key])), "COUNT_TOO_LARGE");
              report[key] = Number(rows[0][key]);
            }
        }
        return rows;
      },
      mediaAsset: {
        aggregate: async () => {
          const result = (
            await client.query(
              `SELECT COALESCE(SUM(a."sizeBytes"),0)::text AS bytes FROM "MediaAsset" a
          LEFT JOIN "MediaUploadSession" s ON s."sourceAssetId"=a.id
          WHERE a."channelId"=$1::uuid AND a.kind='SOURCE_VIDEO'
          AND a.status IN ('PENDING','UPLOADED','VALIDATED') AND a."removedAt" IS NULL
          AND NOT (a.status='PENDING' AND COALESCE(s."sourceProtocolVersion"=2 AND s."grantReservationCount"=0
            AND s."lastGrantExpiresAt" IS NULL AND s."providerExposureBytes"=0,false))`,
              [channelId],
            )
          ).rows[0];
          report.channelLiveSourceBytes = Number(result.bytes);
          return { _sum: { sizeBytes: BigInt(result.bytes) } };
        },
      },
    };
    report.channelQuotaBytes = setting("uploadChannelQuotaBytes");
    report.newIssuanceBefore = loadMediaStorageConfig(env).recoveryV2Enabled;
    const counts = (
      await client.query(
        `SELECT
      (SELECT COUNT(*)::int FROM "MediaUploadSession" WHERE "sourceProtocolVersion"=2) AS "v2SessionCount",
      (SELECT COUNT(*)::int FROM "MediaUploadSession" WHERE "channelId"=$1::uuid) AS "channelSessionCount",
      (SELECT COUNT(*)::int FROM "MediaProcessingOutputReservation" WHERE "channelId"=$1::uuid) AS "outputReservationCount",
      (SELECT COUNT(*)::int FROM "MediaProcessingJob" WHERE status IN
        ('PROCESSING','UPLOADING','VERIFYING','QUEUED','INTEGRITY_QUEUED','INGESTING')) AS "activeProcessingJobs"`,
        [channelId],
      )
    ).rows[0];
    Object.assign(report, counts);
    await readTx.mediaAsset.aggregate();
    if (report.channelSessionCount === 1) {
      const rows = (
        await client.query(
          `SELECT s.id, s.state, s.revision, s."sourceProtocolVersion",
        s."sizeBytes"::text AS "sizeBytes", s."grantReservationCount",
        s."providerExposureBytes"::text AS "sourceExposureBytes",
        s."providerUploadId" IS NOT NULL AS "allocationRecorded",
        s."cleanupRequestedAt" IS NOT NULL AS "cleanupRequested",
        (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='CREATE') AS "createOperations",
        (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='AUTHORIZE') AS "authorizeOperations",
        (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='RESUME') AS "resumeOperations",
        (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind='COMPLETE') AS "completeOperations",
        (SELECT COUNT(*)::int FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o."providerOutcome"='UNKNOWN') AS "unknownOperations",
        (SELECT COUNT(*)::int FROM "MediaProcessingJob" j WHERE j."videoId"=s."videoId") AS "fixtureProcessingJobs",
        (SELECT COUNT(*)::int FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id) AS "fixtureCleanupJobs",
        (SELECT COALESCE(SUM(r."envelopeBytes"),0)::text FROM "MediaProcessingOutputReservation" r WHERE r."uploadSessionId"=s.id) AS "fixtureOutputReservedBytes"
        FROM "MediaUploadSession" s WHERE s."channelId"=$1::uuid AND s."initiatingAccountId"=$2::uuid
          AND s."sourceProtocolVersion"=2`,
          [channelId, accountId],
        )
      ).rows;
      if (rows.length === 1) {
        const row = rows[0];
        report.sessionFingerprint = digest(row.id);
        report.sessionState = row.state;
        for (const key of [
          "revision",
          "sourceProtocolVersion",
          "sizeBytes",
          "grantReservationCount",
          "sourceExposureBytes",
          "createOperations",
          "authorizeOperations",
          "resumeOperations",
          "completeOperations",
          "unknownOperations",
          "fixtureProcessingJobs",
          "fixtureCleanupJobs",
          "fixtureOutputReservedBytes",
        ]) {
          check(row[key] !== null && Number.isSafeInteger(Number(row[key])), "SNAPSHOT_INVALID");
          report[key] = Number(row[key]);
        }
        report.allocationRecorded = row.allocationRecorded;
        report.cleanupRequested = row.cleanupRequested;
        if (mode === "verify") {
          check(
            report.sessionFingerprint ===
              "d88f09decfb9c8be70902626236a92dec4578ee52d6b778f85b6ca2ab59868fc",
            "FIXTURE_CHANGED",
          );
          const detail = (
            await client.query(
              `SELECT s."objectKey", s."providerUploadId", s."contentIdentityDigest",
            j.id AS "jobId", j.status AS "jobStatus", j."inputVerifiedAt", j."outputVerifiedAt",
            j."inputIntegrityDigest", j."outputIntegrityDigest", j."outputIntegritySizeBytes"::text AS "outputBytes",
            j."outputR2ObjectKey", j.attempt, a."thumbnailR2ObjectKey", v.status AS "videoStatus",
            (SELECT COUNT(*)::int FROM "MediaProcessingOutputAttempt" a2 WHERE a2."processingJobId"=j.id) AS "outputAttempts",
            (SELECT COUNT(*)::int FROM "MediaProcessingOutputWrite" w WHERE w."processingJobId"=j.id) AS "outputWrites",
            (SELECT COUNT(*)::int FROM "MediaProcessingOutputWrite" w WHERE w."processingJobId"=j.id AND w.status <> 'ACKNOWLEDGED') AS "unacknowledgedWrites",
            (SELECT COUNT(*)::int FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id AND d.status='DONE') AS "cleanupDone",
            (SELECT COUNT(*)::int FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id AND d.status <> 'DONE') AS "cleanupPending"
            FROM "MediaUploadSession" s JOIN "MediaProcessingJob" j ON j."inputIntegritySessionId"=s.id
            JOIN "MediaProcessingOutputAttempt" a ON a.id=j."currentOutputAttemptId"
            JOIN "Video" v ON v.id=s."videoId" WHERE s.id=$1::uuid`,
              [row.id],
            )
          ).rows;
          check(detail.length === 1, "FIXTURE_JOB_COUNT");
          verifiedFixture = detail[0];
          report.jobStatus = verifiedFixture.jobStatus;
          report.videoStatus = verifiedFixture.videoStatus;
          report.inputVerified = !!verifiedFixture.inputVerifiedAt;
          report.outputVerified = !!verifiedFixture.outputVerifiedAt;
          report.inputMatchesFixture =
            verifiedFixture.inputIntegrityDigest ===
              "cb4c9d221282c056fe9ad2ff587bba9d884461e202e8c34cb11bd766e73c3ab1";
          // READY transfers the identity proof to the job and retires the
          // upload-session digest when source cleanup is registered.
          report.sessionDigestRetired =
            report.cleanupRequested && verifiedFixture.contentIdentityDigest === null;
          for (const key of [
            "attempt",
            "outputBytes",
            "outputAttempts",
            "outputWrites",
            "unacknowledgedWrites",
            "cleanupDone",
            "cleanupPending",
          ])
            report[key] = Number(verifiedFixture[key]);
        }
      }
    }
    if (["enable", "resume"].includes(mode)) {
      if (mode === "enable") {
        check(
          !report.newIssuanceBefore && !fs.existsSync(JOURNAL) && !fs.existsSync(BACKUP),
          "ALREADY_ACTIVATED",
        );
        for (const key of Object.keys(values))
          check(env[key] === undefined || env[key] === "0", "CONFIG_ALREADY_SCOPED");
      } else {
        check(!report.newIssuanceBefore, "PREVIOUS_NOT_CLOSED");
        privateFile(JOURNAL);
        privateFile(BACKUP);
        predecessorText = fs.readFileSync(JOURNAL, "utf8");
        validateResume(
          JSON.parse(predecessorText),
          fs.readFileSync(BACKUP, "utf8"),
          currentText,
          values,
          fs.existsSync(RESUME_JOURNAL),
        );
        check(
          report.v2SessionCount === 0 && report.outputReservationCount === 0,
          "PREVIOUS_WORK_EXISTS",
        );
        for (const name of ["ayin-api", "ayin-media-worker"])
          live(name, { ...values, [prefix + "V2_ENABLED"]: "0" });
        report.previousClosureVerified = true;
      }
      await canary.assertUploadCanarySlot(readTx);
      await admission.assertUploadSessionCapacity(readTx, accountId, channelId);
      await admission.assertUploadDebtByteCapacity(
        readTx,
        accountId,
        channelId,
        admission.conservativeMultipartExposure(1048576, config.partSizeBytes) + 33554432n,
        { account: 5402263552, channel: 5402263552 },
      );
      await admission.assertUploadByteQuota(readTx, channelId, 1048576, report.channelQuotaBytes);
      check(
        setting("uploadMaxSizeBytes") >= 1048576 && setting("mediaProcessingEnabled"),
        "UPLOAD_NOT_READY",
      );
      check(
        !(setting("mediaHlsEnabled") && setting("mediaHlsNewUploadsEnabled")),
        "HLS_UNEXPECTEDLY_ACTIVE",
      );
      const jobs = (
        await client.query(`SELECT COUNT(*)::int AS count FROM "MediaProcessingJob"
        WHERE status IN ('PROCESSING','UPLOADING','VERIFYING','QUEUED','INTEGRITY_QUEUED','INGESTING')`)
      ).rows[0];
      check(jobs.count === 0, "PROCESSING_NOT_IDLE");
      for (const name of ["ayin-api", "ayin-media-worker"]) {
        const process = live(name, {});
        check(!loadMediaStorageConfig(process.env).recoveryV2Enabled, "LIVE_ALREADY_ENABLED");
      }
      report.slotAvailableBefore = true;
    } else {
      privateFile(JOURNAL);
      const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
      check(
        journal.accountId === accountId &&
          journal.channelId === channelId &&
          journal.releaseSha === SHA,
        "JOURNAL_SCOPE_MISMATCH",
      );
      for (const [key, value] of Object.entries(values))
        if (key !== prefix + "V2_ENABLED") check(env[key] === value, "CONFIG_SCOPE_MISMATCH");
    }
    await client.query("ROLLBACK");
    await client.end();
    client = null;
    check(fs.realpathSync(CURRENT) === root, "RELEASE_CHANGED");
    if (mode === "inspect" || mode === "verify") {
      report.newIssuanceAfter = report.newIssuanceBefore;
      for (const name of ["ayin-api", "ayin-media-worker"])
        live(name, { ...values, [prefix + "V2_ENABLED"]: env[prefix + "V2_ENABLED"] });
      if (mode === "verify") {
        check(
          verifiedFixture &&
            report.jobStatus === "READY" &&
            report.inputMatchesFixture &&
            report.sessionDigestRetired &&
            report.inputVerified &&
            report.outputVerified,
          "FIXTURE_NOT_READY",
        );
        const { R2MediaStorageAdapter } = await moduleAt("media/r2-media-storage.adapter");
        const { R2HttpError } = await moduleAt("media/r2-sigv4");
        const { hashUploadFileIdentity } = await import(
          pathToFileURL(`${root}/packages/types/dist/upload-file-identity.js`).href
        );
        const adapter = new R2MediaStorageAdapter(loadMediaStorageConfig(providerEnv));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
          check(
            ["GET", "HEAD"].includes(init?.method) && report.providerRequests < 6,
            "READ_ONLY_PROVIDER_LIMIT",
          );
          report.providerRequests++;
          return originalFetch(url, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(15000),
              ...(init.signal ? [init.signal] : []),
            ]),
          });
        };
        try {
          try {
            await adapter.headObject(verifiedFixture.objectKey);
            report.sourceAbsent = false;
          } catch (error) {
            check(
              error instanceof R2HttpError && error.status === 404,
              "SOURCE_OBSERVATION_FAILED",
            );
            report.sourceAbsent = true;
          }
          const bytes = await adapter.readObject(verifiedFixture.outputR2ObjectKey, 33554432);
          const identity = await hashUploadFileIdentity(
            (async function* () {
              yield bytes;
            })(),
            bytes.length,
          );
          check(
            identity.rootSha256 === verifiedFixture.outputIntegrityDigest &&
              bytes.length === report.outputBytes,
            "OUTPUT_READBACK_MISMATCH",
          );
          report.outputReadbackMatches = true;
          report.outputSha256 = digest(bytes);
          const thumbnail = await adapter.headObject(verifiedFixture.thumbnailR2ObjectKey);
          report.thumbnailBytes = thumbnail.sizeBytes;
          report.thumbnailPresent = thumbnail.sizeBytes > 0;
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
    } else {
      stage = "CONFIG_WRITE";
      const desired = patchEnv(currentText, values),
        parsed = parseEnvText(desired);
      const touched = new Set(Object.keys(values));
      for (const key of new Set([...Object.keys(parsed), ...Object.keys(env)]))
        check(touched.has(key) || parsed[key] === env[key], "UNRELATED_SETTING_CHANGED");
      if (mode === "enable") {
        exclusive(BACKUP, currentText);
        exclusive(
          JOURNAL,
          JSON.stringify(
            {
              releaseSha: SHA,
              accountId,
              channelId,
              approvedBounds: bounds,
              originalEnvSha256: digest(currentText),
              enabledEnvSha256: digest(desired),
              startedAt: new Date().toISOString(),
              fixtureSha256: "184bb9e5d9ad3218af8c4f4552558c24c506d166c293dbbc83becd810e4db98c",
              fixtureBytes: 478196,
              cleanupApproved: false,
              baseline: report,
            },
            null,
            2,
          ) + "\n",
        );
      }
      if (mode === "resume") {
        check(fs.readFileSync(JOURNAL, "utf8") === predecessorText, "PREDECESSOR_CHANGED");
        exclusive(
          RESUME_JOURNAL,
          JSON.stringify(
            {
              releaseSha: SHA,
              accountId,
              channelId,
              approvedBounds: bounds,
              predecessorSha256: digest(predecessorText),
              disabledEnvSha256: digest(currentText),
              enabledEnvSha256: digest(desired),
              startedAt: new Date().toISOString(),
              cleanupApproved: false,
              baseline: report,
            },
            null,
            2,
          ) + "\n",
        );
        const journalDir = fs.openSync("/home/ayin/env", "r");
        try {
          fs.fsyncSync(journalDir);
        } finally {
          fs.closeSync(journalDir);
        }
        report.resumeJournalReserved = true;
      }
      replaceEnv(currentText, desired);
      currentText = desired;
      changed = true;
      stage = "RELOAD";
      pm2Restart();
      stage = "VERIFY";
      await healthy();
      for (const name of ["ayin-api", "ayin-media-worker"]) live(name, values);
      report.newIssuanceAfter = ["enable", "resume"].includes(mode);
      report.runtimeSettingsMatch = true;
    }
    output(JSON.stringify({ ...report, status: "VERIFIED" }) + "\n");
  } catch (error) {
    if (client) await client.end().catch(() => {});
    if (changed && ["enable", "resume"].includes(mode)) {
      try {
        const disabled = patchEnv(currentText, { [prefix + "V2_ENABLED"]: "0" });
        replaceEnv(currentText, disabled);
        pm2Restart();
        await healthy();
        for (const name of ["ayin-api", "ayin-media-worker"])
          live(name, { ...values, [prefix + "V2_ENABLED"]: "0" });
        report.rolledBackToDisabled = true;
      } catch {
        report.rolledBackToDisabled = false;
      }
    }
    const code = /^[A-Z_]{1,70}$/.test(error.message) ? error.message : "BOUNDED_OPERATION_FAILED";
    output(
      JSON.stringify({ ...report, status: "BLOCKED", stage, code, configurationChanged: changed }) +
        "\n",
    );
    process.exitCode = 2;
  }
}
if (process.argv[1] === "-") await execute(process.argv[2]);
