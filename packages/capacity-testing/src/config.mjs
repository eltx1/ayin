const PRODUCTION_HOSTS = new Set([
  "ayin.stream",
  "api.ayin.stream",
  "media.ayin.stream",
  "13.52.116.200",
]);

export const profiles = Object.freeze({
  smoke: { durationSeconds: 10, requestsPerSecond: 2, concurrency: 2, requestBudget: 20 },
  normal: { durationSeconds: 60, requestsPerSecond: 10, concurrency: 10, requestBudget: 600 },
  peak: { durationSeconds: 120, requestsPerSecond: 25, concurrency: 25, requestBudget: 3_000 },
  stress: { durationSeconds: 180, requestsPerSecond: 50, concurrency: 50, requestBudget: 9_000 },
  soak: { durationSeconds: 1_800, requestsPerSecond: 10, concurrency: 10, requestBudget: 18_000 },
});

const highLoadProfiles = new Set(["stress", "soak"]);

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function csv(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function assertSafeHost(url, environment, allowedHosts, label) {
  const hostname = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname) || hostname.endsWith(".ayin.stream")) {
    throw new Error(`${label} points at a protected production host`);
  }
  if (environment === "local" && !isLoopback(hostname)) {
    throw new Error(`${label} must be loopback when AYIN_CAPACITY_ENVIRONMENT=local`);
  }
  if (environment === "staging" && !allowedHosts.has(hostname)) {
    throw new Error(`${label} host must be explicitly allow-listed`);
  }
}

function parseHttpTarget(raw, environment, allowedHosts) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("AYIN_CAPACITY_API_URL must use HTTP(S)");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Target URL cannot contain credentials, query, or fragment");
  if (url.pathname !== "/")
    throw new Error("AYIN_CAPACITY_API_URL must be an origin without a path");
  assertSafeHost(url, environment, allowedHosts, "API target");
  return url;
}

function parseDatabaseTarget(raw, environment, allowedHosts) {
  if (!raw) return null;
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("AYIN_CAPACITY_DATABASE_URL must be PostgreSQL");
  assertSafeHost(url, environment, allowedHosts, "Database target");
  return raw;
}

export function loadCapacityConfig(env = process.env) {
  const environment = required(env, "AYIN_CAPACITY_ENVIRONMENT").toLowerCase();
  if (!["local", "staging"].includes(environment))
    throw new Error("Capacity tests only support local or staging");

  const profileName = (env.AYIN_CAPACITY_PROFILE ?? "smoke").toLowerCase();
  const profile = profiles[profileName];
  if (!profile) throw new Error(`Unknown capacity profile: ${profileName}`);
  const mode = (env.AYIN_CAPACITY_MODE ?? "http").toLowerCase();
  if (!["http", "queue"].includes(mode))
    throw new Error("AYIN_CAPACITY_MODE must be http or queue");

  const allowedHosts = csv(env.AYIN_CAPACITY_ALLOWED_HOSTS);
  if (
    environment === "staging" &&
    env.AYIN_CAPACITY_RUN_CONFIRMATION !== "RUN_SAFE_CAPACITY_TEST"
  ) {
    throw new Error("Staging requires AYIN_CAPACITY_RUN_CONFIRMATION=RUN_SAFE_CAPACITY_TEST");
  }
  if (
    highLoadProfiles.has(profileName) &&
    env.AYIN_CAPACITY_HIGH_LOAD_CONFIRMATION !== "RUN_HIGH_LOAD_PROFILE"
  ) {
    throw new Error(
      `${profileName} requires AYIN_CAPACITY_HIGH_LOAD_CONFIRMATION=RUN_HIGH_LOAD_PROFILE`,
    );
  }

  const apiUrl = parseHttpTarget(required(env, "AYIN_CAPACITY_API_URL"), environment, allowedHosts);
  const databaseAllowedHosts = csv(env.AYIN_CAPACITY_ALLOWED_DATABASE_HOSTS);
  const databaseUrl = parseDatabaseTarget(
    env.AYIN_CAPACITY_DATABASE_URL,
    environment,
    databaseAllowedHosts,
  );
  const enableMutations = env.AYIN_CAPACITY_ENABLE_MUTATIONS === "1";
  if (enableMutations && !databaseUrl)
    throw new Error("Mutating scenarios require AYIN_CAPACITY_DATABASE_URL for cleanup");
  if (mode === "queue" && !databaseUrl)
    throw new Error("Queue mode requires AYIN_CAPACITY_DATABASE_URL");
  if (mode === "queue" && env.AYIN_CAPACITY_QUEUE_CONFIRMATION !== "OBSERVE_SYNTHETIC_QUEUE") {
    throw new Error("Queue mode requires AYIN_CAPACITY_QUEUE_CONFIRMATION=OBSERVE_SYNTHETIC_QUEUE");
  }

  const timeoutMs = Number(env.AYIN_CAPACITY_TIMEOUT_MS ?? 5_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new Error("AYIN_CAPACITY_TIMEOUT_MS must be an integer from 100 to 30000");

  return {
    environment,
    profileName,
    profile,
    mode,
    apiUrl,
    databaseUrl,
    enableMutations,
    watchSlug: env.AYIN_CAPACITY_WATCH_SLUG?.trim() || null,
    searchQuery: env.AYIN_CAPACITY_SEARCH_QUERY?.trim() || "video",
    loginEmail: env.AYIN_CAPACITY_LOGIN_EMAIL?.trim() || null,
    loginPassword: env.AYIN_CAPACITY_LOGIN_PASSWORD || null,
    uploadChannelId: env.AYIN_CAPACITY_UPLOAD_CHANNEL_ID?.trim() || null,
    targetPids: env.AYIN_CAPACITY_TARGET_PIDS?.trim() || null,
    outputPath: env.AYIN_CAPACITY_OUTPUT?.trim() || "capacity-report.json",
    releaseSha: env.GITHUB_SHA?.trim() || env.RELEASE_SHA?.trim() || null,
    timeoutMs,
  };
}

export const capacityInternals = { assertSafeHost, isLoopback, parseDatabaseTarget };
