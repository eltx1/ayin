// PREPARED ONLY. Stream through the reviewed SSH command; do not run locally.
// Only /proc + release files, loopback health, and one read-only DB snapshot.
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const EXPECTED = 'ab8355f3c45e5208ef9fe6477666b8f834c231b4';
const CURRENT = '/home/ayin/htdocs/current';
let ROOT;
const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const report = { schemaVersion: 1, status: 'INCOMPLETE', expectedReleaseSha: EXPECTED,
  readOnly: true, activatesCanary: false, providerRequests: 0, databaseConnections: 0 };
let stage = 'RELEASE_UNRESOLVED';
const output = process.stdout.write.bind(process.stdout);
// Neither library diagnostics nor exception text may escape the process.
process.stdout.write = process.stderr.write = () => true;
function finish(status) {
  report.status = status;
  if (status !== 'OBSERVED') report.missingBound = stage;
  output(`${JSON.stringify(report)}\n`);
  process.exit(status === 'OBSERVED' ? 0 : 2);
}
setTimeout(() => { stage = 'READ_DEADLINE_EXCEEDED'; finish('INCOMPLETE'); }, 45000).unref();
function check(ok) { if (!ok) throw new Error(); }
function small(path, cap = 1024 * 1024) {
  const bytes = readFileSync(path); check(bytes.length <= cap); return bytes.toString('utf8');
}
function integer(value) {
  const n = Number(value); check(Number.isSafeInteger(n) && n >= 0); return n;
}
function enumOf(value, allowed) { check(allowed.includes(value)); return value; }
function statToken(pid) { return small(`/proc/${pid}/stat`, 8192).replace(/^.*\) /, '').split(' ')[19]; }
function live(name) {
  const filenames = readdirSync('/home/ayin/.pm2/pids'); check(filenames.length <= 128);
  const candidates = filenames.filter((f) => new RegExp(`^${name}-[0-9]+\\.pid$`).test(f));
  check(candidates.length >= 1 && candidates.length <= 4);
  const found = [];
  for (const file of candidates) {
    const pid = small(`/home/ayin/.pm2/pids/${file}`, 32).trim(); check(/^[1-9][0-9]{0,8}$/.test(pid));
    let raw;
    try { raw = small(`/proc/${pid}/environ`); } catch { continue; }
    const env = Object.fromEntries(raw.split('\0').filter(Boolean).map((item) => {
      const at = item.indexOf('='); check(at > 0); return [item.slice(0, at), item.slice(at + 1)];
    }));
    check(env.AYIN_SERVICE_NAME === name && env.AYIN_RELEASE_SHA === EXPECTED);
    check(realpathSync(`/proc/${pid}/cwd`) === realpathSync(`${ROOT}/apps/api`));
    found.push({ pid: Number(pid), token: statToken(pid), env });
  }
  check(found.length === 1); return found[0];
}
const moduleAt = (relative) => import(pathToFileURL(`${ROOT}/apps/api/dist/${relative}.js`).href);
const storageKeys = {
  recoveryV2Enabled: 'AYIN_UPLOAD_RECOVERY_V2_ENABLED',
  recoveryCanarySourceMaxBytes: 'AYIN_UPLOAD_RECOVERY_CANARY_SOURCE_MAX_BYTES',
  recoveryOutputEnvelopeBytes: 'AYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES',
  recoveryDebtAccountBytes: 'AYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES',
  recoveryDebtChannelBytes: 'AYIN_UPLOAD_RECOVERY_DEBT_CHANNEL_BYTES',
  partSizeBytes: 'R2_PART_SIZE_BYTES', uploadUrlTtlSeconds: 'R2_UPLOAD_URL_TTL_SECONDS',
};
function storageSummary(config, env) {
  return { mode: enumOf(config.mode, ['r2', 'development', 'e2e']),
    tupleAccountPresent: Boolean(config.recoveryCanaryAccountId),
    tupleChannelPresent: Boolean(config.recoveryCanaryChannelId),
    ...Object.fromEntries(Object.entries(storageKeys).map(([key, variable]) => [key, {
      value: config[key], source: env[variable] === undefined ? 'RUNTIME_DEFAULT' : 'PROCESS_ENV',
    }])) };
}
async function health(path) {
  const response = await fetch(`http://127.0.0.1:4000/${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' },
  });
  let body = ''; for await (const chunk of response.body) {
    body += Buffer.from(chunk).toString('utf8'); check(body.length <= 16384);
  }
  const value = JSON.parse(body); check(SHA.test(value.releaseSha));
  return { httpStatus: response.status,
    status: enumOf(value.status, ['alive', 'ready', 'not_ready']), releaseSha: value.releaseSha,
    releaseMatches: value.releaseSha === EXPECTED };
}

try {
  check(process.env.USER === 'ayin' && process.env.HOME === '/home/ayin');
  ROOT = realpathSync(CURRENT);
  check(ROOT.startsWith('/home/ayin/htdocs/releases/'));
  const release = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, timeout: 2000,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  check(release === EXPECTED); report.releaseSha = release;
  stage = 'LIVE_API_ENV_UNRESOLVED'; const api = live('ayin-api');
  stage = 'LIVE_WORKER_ENV_UNRESOLVED'; const worker = live('ayin-media-worker');
  stage = 'RUNTIME_CONTRACT_UNRESOLVED';
  const [storage, timeouts, canary, admission, cleanup, catalogModule] = await Promise.all([
    moduleAt('media/media-storage.config'), moduleAt('media/media-processing-timeouts'),
    moduleAt('media/media-upload-canary'), moduleAt('media/media-upload-admission'),
    moduleAt('media/media-upload-cleanup'), moduleAt('platform-config/platform-settings.catalog'),
  ]);
  stage = 'API_STORAGE_SETTINGS_UNRESOLVED'; const cfg = storage.loadMediaStorageConfig(api.env);
  stage = 'WORKER_STORAGE_SETTINGS_UNRESOLVED'; const workerCfg = storage.loadMediaStorageConfig(worker.env);
  report.api = storageSummary(cfg, api.env); report.worker = storageSummary(workerCfg, worker.env);
  report.runtimeSettingsMatch = Object.keys(storageKeys).every((key) => cfg[key] === workerCfg[key]) &&
    cfg.recoveryCanaryAccountId === workerCfg.recoveryCanaryAccountId &&
    cfg.recoveryCanaryChannelId === workerCfg.recoveryCanaryChannelId;
  report.databaseTargetMatches = Boolean(api.env.DATABASE_URL) && api.env.DATABASE_URL === worker.env.DATABASE_URL;
  report.api.canaryConfigurationValid = canary.configuredUploadCanary(cfg) !== null;
  report.worker.canaryConfigurationValid = canary.configuredUploadCanary(workerCfg) !== null;
  report.fixtureFitsSourceCeiling = cfg.recoveryCanarySourceMaxBytes >= 240643;
  report.fixturePartCount = Math.ceil(240643 / cfg.partSizeBytes);
  for (const [name, runtime] of [['api', api], ['worker', worker]]) {
    stage = name === 'api' ? 'API_TIMEOUTS_UNRESOLVED' : 'WORKER_TIMEOUTS_UNRESOLVED';
    report[name].timeoutsMs = timeouts.resolveMediaProcessingTimeouts(runtime.env);
    report[name].timeoutEnvironmentPresent = Object.fromEntries([
      'FFPROBE', 'FFMPEG', 'R2_METADATA', 'R2_TRANSFER',
    ].map((key) => [key, Boolean(runtime.env[`MEDIA_PROCESSING_${key}_TIMEOUT_SECONDS`]?.trim())]));
    // null bypasses the parameter's process.env default and reaches its source-defined fallback.
    report[name].cleanupRetentionDays = cleanup.uploadCleanupRetentionDays(runtime.env.MEDIA_UPLOAD_CLEANUP_RETENTION_DAYS ?? null);
    report[name].cleanupRetentionEnvironmentPresent = runtime.env.MEDIA_UPLOAD_CLEANUP_RETENTION_DAYS !== undefined;
  }
  report.cleanupMaxAttempts = integer(cleanup.MAX_MEDIA_CLEANUP_ATTEMPTS);
  stage = 'LIVE_HEALTH_UNRESOLVED';
  report.health = await health('health'); report.readiness = await health('health/ready');
  stage = 'WORKER_HEARTBEAT_UNRESOLVED';
  const heartbeatPath = worker.env.MEDIA_WORKER_HEARTBEAT_PATH ?? '/tmp/ayin-media-worker-heartbeat.json';
  check(heartbeatPath.startsWith('/tmp/') || heartbeatPath.startsWith('/home/ayin/'));
  const heartbeat = JSON.parse(small(heartbeatPath, 16384));
  check(heartbeat.pid === worker.pid && heartbeat.releaseSha === EXPECTED);
  const ageMs = Date.now() - Date.parse(heartbeat.heartbeatAt); check(Number.isFinite(ageMs));
  report.workerHeartbeat = { releaseSha: heartbeat.releaseSha,
    status: enumOf(heartbeat.status, ['running', 'draining', 'stopped']),
    ageMs, fresh: ageMs >= 0 && ageMs <= 30000, activeJobs: integer(heartbeat.activeJobs),
    concurrencyLimit: integer(heartbeat.concurrencyLimit), processingVersion: integer(heartbeat.processingVersion) };
  stage = 'DATABASE_SNAPSHOT_UNRESOLVED'; check(report.databaseTargetMatches);
  const require = createRequire(`${ROOT}/packages/db/package.json`);
  const { Client } = require('pg');
  const client = new Client({ connectionString: api.env.DATABASE_URL, connectionTimeoutMillis: 3000,
    statement_timeout: 3000, query_timeout: 4000, application_name: 'ayin-canary-readonly-preflight',
    options: '-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=6000' });
  await client.connect(); report.databaseConnections = 1;
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  check((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only === 'on');
  const keys = ['mediaProcessingEnabled', 'mediaProcessingConcurrentJobs', 'mediaProcessingRetryLimit',
    'mediaProcessingLeaseSeconds', 'mediaProcessingFfmpegThreadsPerJob', 'mediaProcessingScratchMaxBytesPerJob',
    'mediaHlsEnabled', 'mediaHlsNewUploadsEnabled'];
  const rows = (await client.query('SELECT key, "schemaVersion", "valueType", value FROM "PlatformSetting" WHERE namespace=\'UPLOAD\' AND key=ANY($1::text[])', [keys])).rows;
  const catalog = catalogModule.platformSettingCatalog; report.settings = {};
  for (const key of keys) {
    const definition = catalog[key], row = rows.find((r) => r.key === key);
    check(definition?.namespace === 'UPLOAD');
    const parsed = row?.schemaVersion === 1 && row.valueType === definition.valueType ? definition.schema.safeParse(row.value) : null;
    const value = parsed?.success ? parsed.data : definition.defaultValue;
    check(typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value)));
    report.settings[key] = { value, source: parsed?.success ? 'STORED' : row ? 'RUNTIME_DEFAULT_INVALID_STORED' : 'RUNTIME_DEFAULT_MISSING' };
  }
  report.hlsForNewUploads = report.settings.mediaHlsEnabled.value && report.settings.mediaHlsNewUploadsEnabled.value;
  report.effectiveLocalConcurrency = Math.min(128, report.workerHeartbeat.concurrencyLimit, report.settings.mediaProcessingConcurrentJobs.value);
  report.processing = (await client.query(`SELECT
    COUNT(*) FILTER (WHERE status IN ('PROCESSING','UPLOADING','VERIFYING'))::int AS "activeJobs",
    COUNT(*) FILTER (WHERE status IN ('QUEUED','INTEGRITY_QUEUED'))::int AS "queuedJobs",
    COUNT(*) FILTER (WHERE status='INGESTING')::int AS "ingestingJobs",
    COUNT(*) FILTER (WHERE "outputProtocolVersion"=2 AND status NOT IN ('READY','CANCELLED'))::int AS "unsettledV2Jobs"
    FROM "MediaProcessingJob"`)).rows[0];
  const accountId = cfg.recoveryCanaryAccountId, channelId = cfg.recoveryCanaryChannelId;
  report.selectedChannel = (await client.query(`SELECT EXISTS(SELECT 1 FROM "Channel" WHERE handle='mr-lord' AND "removedAt" IS NULL AND status='ACTIVE') AS present,
    EXISTS(SELECT 1 FROM "Channel" WHERE handle='mr-lord' AND id=$1::uuid AND "removedAt" IS NULL AND status='ACTIVE') AS "configuredChannelMatches",
    EXISTS(SELECT 1 FROM "Channel" c JOIN "ChannelMember" m ON m."channelId"=c.id WHERE c.handle='mr-lord' AND c.id=$1::uuid AND m."accountId"=$2::uuid AND m.role='OWNER' AND c."removedAt" IS NULL AND c.status='ACTIVE') AS "configuredAccountIsOwner"`,
    [UUID.test(channelId ?? '') ? channelId : null, UUID.test(accountId ?? '') ? accountId : null])).rows[0];
  // Reuse only these three pure SELECT helpers. No advisory locks or mutations.
  async function observe(fn, expectedCode, ...args) {
    let observed, calls = 0;
    const tx = { $queryRaw: async (strings, ...values) => {
      check(Array.isArray(strings) && strings.raw && ++calls === 1);
      const text = strings.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, '');
      check(/^\s*(SELECT|WITH)\b/.test(text) && !/\b(FOR\s+UPDATE|pg_\w*lock|INSERT|UPDATE|DELETE|CALL|COPY)\b/i.test(text));
      observed = (await client.query(text, values)).rows[0]; return [observed];
    } };
    let passes = true;
    try { await fn(tx, ...args); } catch (error) { check(error?.code === expectedCode); passes = false; }
    check(calls === 1 && observed); return { passes, observed };
  }
  const slot = await observe(canary.assertUploadCanarySlot, 'UPLOAD_CANARY_BUSY');
  report.globalCanarySlot = { available: slot.passes, occupied: Boolean(slot.observed.occupied) };
  if (UUID.test(accountId ?? '') && UUID.test(channelId ?? '')) {
    const count = await observe(admission.assertUploadSessionCapacity, 'UPLOAD_ADMISSION_LIMIT', accountId, channelId);
    report.admissionCounts = { passes: count.passes,
      ...Object.fromEntries(Object.keys(admission.UPLOAD_ADMISSION_LIMITS).map((key) => [key, {
        occupied: integer(count.observed[key]), limit: integer(admission.UPLOAD_ADMISSION_LIMITS[key]),
      }])) };
    const required = admission.conservativeMultipartExposure(240643, cfg.partSizeBytes) + BigInt(cfg.recoveryOutputEnvelopeBytes);
    const debt = await observe(admission.assertUploadDebtByteCapacity, 'UPLOAD_PHYSICAL_DEBT_LIMIT', accountId, channelId,
      required, { account: cfg.recoveryDebtAccountBytes, channel: cfg.recoveryDebtChannelBytes });
    report.debt = { status: 'OBSERVED', firstGrantFits: debt.passes,
      requiredFirstGrantBytes: integer(required), accountBytes: integer(debt.observed.accountBytes),
      channelBytes: integer(debt.observed.channelBytes), unaccountedSources: integer(debt.observed.unaccounted) };
  } else report.debt = { status: 'TUPLE_MISSING' };
  await client.query('ROLLBACK'); await client.end();
  stage = 'PROCESS_CHANGED_DURING_READ';
  check(statToken(api.pid) === api.token && statToken(worker.pid) === worker.token);
  stage = 'RELEASE_CHANGED_DURING_READ'; check(realpathSync(CURRENT) === ROOT);
  finish('OBSERVED');
} catch { finish('INCOMPLETE'); }
