import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const validator = resolve("deploy/validate-production-env.cjs");
const ecosystem = resolve("deploy/ecosystem.config.cjs");
const edgeToken = "controlled-edge-token-do-not-print-0123456789abcdef";
const unrelatedSecret = "unrelated-server-secret-do-not-forward-0123456789";
const baseWeb = {
  NODE_ENV: "production",
  NEXT_PUBLIC_API_BASE_URL: "https://api.ayin.stream",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayin.stream",
};
const baseApi = {
  NODE_ENV: "production",
  APP_ENV: "production",
  API_HOST: "127.0.0.1",
  PORT: "4000",
  CORS_ORIGIN: "https://ayin.stream",
  WEB_ORIGIN: "https://ayin.stream",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test?schema=public",
  AUTH_TOKEN_SECRET: unrelatedSecret,
  PAYOUT_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  ANALYTICS_HASH_SALT: unrelatedSecret,
  UPLOAD_SESSION_SECRET: unrelatedSecret,
  R2_ACCOUNT_ID: "test-account",
  R2_BUCKET: "test-bucket",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: unrelatedSecret,
};

function fixture(t, api = {}, web = {}) {
  const root = mkdtempSync(join(tmpdir(), "ayin-region-runtime-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { web: join(root, "web.env"), api: join(root, "api.env") };
  const save = (path, values) =>
    writeFileSync(
      path,
      Object.entries(values)
        .map(([key, value]) => key + "=" + JSON.stringify(value))
        .join("\n") + "\n",
      { mode: 0o600 },
    );
  save(files.web, { ...baseWeb, ...web });
  save(files.api, { ...baseApi, ...api });
  return files;
}

function validate(files) {
  const result = spawnSync(process.execPath, [validator, files.web, files.api], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.ok(!(result.stdout + result.stderr).includes(edgeToken));
  assert.ok(!(result.stdout + result.stderr).includes(unrelatedSecret));
  return result;
}

function regionSummary(result) {
  const prefix = "Region configuration (not ingress verification): ";
  const line = result.stdout.split("\n").find((entry) => entry.startsWith(prefix));
  assert.ok(line, "successful validation must report the allowlisted configuration booleans");
  return JSON.parse(line.slice(prefix.length));
}

test("absent region configuration stays disabled and is reported without secrets", (t) => {
  const result = validate(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(regionSummary(result), {
    cloudflareTrustEnabled: false,
    internalTokenConfigured: false,
    webRegionForwardingEnabled: false,
    runtimeCountryForwardingConfigured: false,
    ingressVerified: false,
  });
});

test("an internal token alone does not activate Cloudflare country trust", (t) => {
  const result = validate(fixture(t, { AYIN_INTERNAL_EDGE_TOKEN: edgeToken }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(regionSummary(result), {
    cloudflareTrustEnabled: false,
    internalTokenConfigured: true,
    webRegionForwardingEnabled: false,
    runtimeCountryForwardingConfigured: false,
    ingressVerified: false,
  });
});

for (const gate of [undefined, "", "false"]) {
  for (const tokenConfigured of [false, true]) {
    test(`legacy API-only trust stays valid with forwarding=${gate ?? "absent"}, token=${tokenConfigured}`, (t) => {
      const result = validate(
        fixture(t, {
          AYIN_TRUST_CLOUDFLARE_REGION: "true",
          ...(gate === undefined ? {} : { AYIN_WEB_REGION_FORWARDING: gate }),
          ...(tokenConfigured ? { AYIN_INTERNAL_EDGE_TOKEN: edgeToken } : {}),
        }),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(regionSummary(result), {
        cloudflareTrustEnabled: true,
        internalTokenConfigured: tokenConfigured,
        webRegionForwardingEnabled: false,
        runtimeCountryForwardingConfigured: false,
        ingressVerified: false,
      });
    });
  }
}

test("enabled Web forwarding requires an internal token", (t) => {
  const result = validate(
    fixture(t, { AYIN_WEB_REGION_FORWARDING: "true", AYIN_TRUST_CLOUDFLARE_REGION: "true" }),
  );
  assert.equal(result.status, 78);
  assert.match(result.stderr, /AYIN_INTERNAL_EDGE_TOKEN/);
  assert.ok(!result.stdout.includes("Region configuration"));
});

for (const trust of [undefined, "", "false"]) {
  test(`enabled Web forwarding requires explicit API trust; trust=${trust ?? "absent"}`, (t) => {
    const result = validate(
      fixture(t, {
        AYIN_WEB_REGION_FORWARDING: "true",
        AYIN_INTERNAL_EDGE_TOKEN: edgeToken,
        ...(trust === undefined ? {} : { AYIN_TRUST_CLOUDFLARE_REGION: trust }),
      }),
    );
    assert.equal(result.status, 78);
    assert.match(result.stderr, /AYIN_TRUST_CLOUDFLARE_REGION/);
    assert.ok(!result.stdout.includes("Region configuration"));
  });
}

test("a valid opted-in configuration still does not claim verified ingress", (t) => {
  const result = validate(
    fixture(t, {
      AYIN_WEB_REGION_FORWARDING: "true",
      AYIN_TRUST_CLOUDFLARE_REGION: "true",
      AYIN_INTERNAL_EDGE_TOKEN: edgeToken,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(regionSummary(result), {
    cloudflareTrustEnabled: true,
    internalTokenConfigured: true,
    webRegionForwardingEnabled: true,
    runtimeCountryForwardingConfigured: true,
    ingressVerified: false,
  });
});

for (const key of ["AYIN_TRUST_CLOUDFLARE_REGION", "AYIN_WEB_REGION_FORWARDING"]) {
  for (const flag of ["TRUE", "1", "yes", " true "]) {
    test(`rejects noncanonical ${key} setting ${JSON.stringify(flag)}`, (t) => {
      const result = validate(fixture(t, { [key]: flag, AYIN_INTERNAL_EDGE_TOKEN: edgeToken }));
      assert.equal(result.status, 78);
      assert.match(result.stderr, new RegExp(key));
    });
  }
}

for (const value of ["short", "x".repeat(257), "x".repeat(32) + ",y", "x".repeat(32) + "\n"]) {
  test("rejects weak or header-unsafe nonempty internal tokens", (t) => {
    const result = validate(fixture(t, { AYIN_INTERNAL_EDGE_TOKEN: value }));
    assert.equal(result.status, 78);
    assert.match(result.stderr, /AYIN_INTERNAL_EDGE_TOKEN/);
    assert.ok(!result.stderr.includes(value));
  });
}

for (const key of [
  "AYIN_INTERNAL_EDGE_TOKEN",
  "NEXT_PUBLIC_AYIN_INTERNAL_EDGE_TOKEN",
  "OTHER_SECRET",
]) {
  test("preserves the web.env secret ban for " + key, (t) => {
    const result = validate(fixture(t, {}, { [key]: edgeToken }));
    assert.equal(result.status, 78);
    assert.match(result.stderr, /web\.env: .* looks secret/);
  });
}

const runtimeCases = [
  { name: "unconfigured", api: {}, forwarding: false },
  {
    name: "legacy API-only trust without token",
    api: { AYIN_TRUST_CLOUDFLARE_REGION: "true" },
    forwarding: false,
  },
  ...[undefined, "", "false"].map((gate) => ({
    name: `legacy API trust and token, forwarding=${gate ?? "absent"}`,
    api: {
      AYIN_TRUST_CLOUDFLARE_REGION: "true",
      AYIN_INTERNAL_EDGE_TOKEN: edgeToken,
      ...(gate === undefined ? {} : { AYIN_WEB_REGION_FORWARDING: gate }),
    },
    forwarding: false,
  })),
  {
    name: "explicit Web forwarding with trusted API and token",
    api: {
      AYIN_WEB_REGION_FORWARDING: "true",
      AYIN_TRUST_CLOUDFLARE_REGION: "true",
      AYIN_INTERNAL_EDGE_TOKEN: edgeToken,
    },
    forwarding: true,
  },
];

for (const { name, api: settings, forwarding } of runtimeCases) {
  test("PM2 exposes only gated runtime region keys: " + name, (t) => {
    const files = fixture(t, settings);
    const result = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).apps))", ecosystem],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          AYIN_WEB_ENV_FILE: files.web,
          AYIN_API_ENV_FILE: files.api,
          AYIN_CURRENT_DIR: resolve("."),
          AYIN_RELEASE_SHA: "1".repeat(40),
        },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const apps = JSON.parse(result.stdout);
    const web = apps.find((app) => app.name === "ayin-web").env;
    const api = apps.find((app) => app.name === "ayin-api").env;
    assert.equal(web.AYIN_INTERNAL_EDGE_TOKEN, forwarding ? edgeToken : "");
    assert.equal(web.AYIN_TRUST_CLOUDFLARE_REGION, forwarding ? "true" : "false");
    assert.equal(web.NEXT_PUBLIC_API_BASE_URL, baseWeb.NEXT_PUBLIC_API_BASE_URL);
    assert.ok(!JSON.stringify(web).includes(unrelatedSecret));
    for (const key of ["DATABASE_URL", "AUTH_TOKEN_SECRET", "R2_SECRET_ACCESS_KEY"])
      assert.equal(web[key], undefined);
    assert.equal(api.AUTH_TOKEN_SECRET, unrelatedSecret);
    for (const [key, value] of Object.entries(settings)) assert.equal(api[key], value);
    if (forwarding) assert.equal(api.AYIN_INTERNAL_EDGE_TOKEN, web.AYIN_INTERNAL_EDGE_TOKEN);
    assert.deepEqual(
      Object.keys(web).sort(),
      [
        ...Object.keys(baseWeb),
        "AYIN_INTERNAL_EDGE_TOKEN",
        "AYIN_TRUST_CLOUDFLARE_REGION",
        "AYIN_RELEASE_SHA",
        "AYIN_SERVICE_NAME",
      ].sort(),
    );
  });
}
