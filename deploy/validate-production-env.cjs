"use strict";

const { assertPrivateFilePermissions, loadEnvFile } = require("./env-file.cjs");

const [webEnvPath, apiEnvPath] = process.argv.slice(2);

if (!webEnvPath || !apiEnvPath) {
  console.error("usage: node deploy/validate-production-env.cjs <web.env> <api.env>");
  process.exit(64);
}

const failures = [];

function fail(message) {
  failures.push(message);
}

function requireValue(env, key, scope) {
  const value = env[key]?.trim();
  if (!value) {
    fail(`${scope}: ${key} is required`);
    return null;
  }
  return value;
}

function requireExact(env, key, expected, scope) {
  const value = requireValue(env, key, scope);
  if (value !== null && value !== expected) {
    fail(`${scope}: ${key} must be ${expected}`);
  }
}

function requireHttpsUrl(env, key, scope, originOnly = false) {
  const value = requireValue(env, key, scope);
  if (value === null) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      fail(`${scope}: ${key} must use https://`);
    }
    if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
      fail(`${scope}: ${key} must be an origin without a path, query, or fragment`);
    }
    return url;
  } catch {
    fail(`${scope}: ${key} must be a valid URL`);
    return null;
  }
}

function requireMinimumLength(env, key, minimum, scope) {
  const value = requireValue(env, key, scope);
  if (value !== null && value.length < minimum) {
    fail(`${scope}: ${key} must be at least ${minimum} characters`);
  }
}

function requireOptionalIntegerRange(env, key, minimum, maximum, scope) {
  const raw = env[key]?.trim();
  if (!raw) return;
  if (!/^\d+$/.test(raw)) {
    fail(`${scope}: ${key} must be an integer between ${minimum} and ${maximum}`);
    return;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${scope}: ${key} must be an integer between ${minimum} and ${maximum}`);
  }
}

function requirePostgresUrl(env, key, scope) {
  const value = requireValue(env, key, scope);
  if (value === null) return;
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname) {
      fail(`${scope}: ${key} must be a valid PostgreSQL connection URL`);
    }
  } catch {
    fail(`${scope}: ${key} must be a valid PostgreSQL connection URL`);
  }
}

function requireBase64Bytes(env, key, byteLength, scope) {
  const value = requireValue(env, key, scope);
  if (value === null) return;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail(`${scope}: ${key} must be valid base64`);
    return;
  }
  if (Buffer.from(value, "base64").length !== byteLength) {
    fail(`${scope}: ${key} must decode to exactly ${byteLength} bytes`);
  }
}

let webEnv;
let apiEnv;
try {
  assertPrivateFilePermissions(webEnvPath);
  assertPrivateFilePermissions(apiEnvPath);
  webEnv = loadEnvFile(webEnvPath);
  apiEnv = loadEnvFile(apiEnvPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(78);
}

requireExact(webEnv, "NODE_ENV", "production", "web.env");
const webApiUrl = requireHttpsUrl(webEnv, "NEXT_PUBLIC_API_BASE_URL", "web.env");
requireHttpsUrl(webEnv, "NEXT_PUBLIC_MEDIA_BASE_URL", "web.env");

for (const [key, value] of Object.entries(webEnv)) {
  if (value && /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|ACCESS_KEY)/i.test(key)) {
    fail(`web.env: ${key} looks secret and must not be exposed to the browser process`);
  }
}

requireExact(apiEnv, "NODE_ENV", "production", "api.env");
requireExact(apiEnv, "APP_ENV", "production", "api.env");
requireExact(apiEnv, "API_HOST", "127.0.0.1", "api.env");
requireExact(apiEnv, "PORT", "4000", "api.env");
const corsOrigin = requireHttpsUrl(apiEnv, "CORS_ORIGIN", "api.env", true);
const webOrigin = requireHttpsUrl(apiEnv, "WEB_ORIGIN", "api.env", true);
requirePostgresUrl(apiEnv, "DATABASE_URL", "api.env");
requireMinimumLength(apiEnv, "AUTH_TOKEN_SECRET", 32, "api.env");
requireBase64Bytes(apiEnv, "PAYOUT_DATA_ENCRYPTION_KEY", 32, "api.env");
requireMinimumLength(apiEnv, "ANALYTICS_HASH_SALT", 32, "api.env");
requireMinimumLength(apiEnv, "UPLOAD_SESSION_SECRET", 32, "api.env");
requireOptionalIntegerRange(
  apiEnv,
  "MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS",
  10,
  600,
  "api.env",
);
requireOptionalIntegerRange(
  apiEnv,
  "MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS",
  60,
  86_400,
  "api.env",
);

for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
  requireValue(apiEnv, key, "api.env");
}

if (corsOrigin && webOrigin && corsOrigin.origin !== webOrigin.origin) {
  fail("api.env: CORS_ORIGIN and WEB_ORIGIN must match for cookie-session CSRF protection");
}

if (webApiUrl && !webApiUrl.pathname.endsWith("/")) {
  // A path is supported by the client, but production currently expects the API at the origin root.
  fail("web.env: NEXT_PUBLIC_API_BASE_URL must not include an API path prefix");
}

const gamProductionEnabled = apiEnv.GAM_PRODUCTION_ENABLED === "1";
if (gamProductionEnabled) {
  for (const key of [
    "GAM_NETWORK_CODE",
    "GAM_PUBLISHER_ID",
    "GAM_VIDEO_AD_UNIT_PATH",
    "GAM_DISPLAY_AD_UNIT_PREFIX",
  ]) {
    requireValue(apiEnv, key, "api.env");
  }
  if (apiEnv.GAM_TEST_MODE === "1") {
    fail("api.env: GAM_TEST_MODE must be 0 when GAM_PRODUCTION_ENABLED=1");
  }
}

if (failures.length) {
  console.error("Production environment validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(78);
}

console.log("Production environment validation passed.");