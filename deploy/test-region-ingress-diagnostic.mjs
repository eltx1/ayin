import assert from "node:assert/strict";
import { test } from "node:test";
import { regionFlags, nginxSummary, pm2Summary, cloudflare } from "./diagnose-region-ingress.mjs";

test("runtime summaries never expose credentials or unrelated process data", () => {
  const secret = "private-token-that-must-not-be-reported-0123456789";
  const env = {
    AYIN_TRUST_CLOUDFLARE_REGION: "true",
    AYIN_INTERNAL_EDGE_TOKEN: secret,
    DATABASE_URL: secret,
  };
  assert.deepEqual(regionFlags(env), {
    cloudflareTrustEnabled: true,
    webRegionForwardingEnabled: false,
    internalTokenConfigured: true,
  });
  const summary = pm2Summary([
    { name: "other-app", pm2_env: env },
    { name: "ayin-web", pm2_env: env },
  ]);
  assert.equal(summary.length, 1);
  assert.ok(!JSON.stringify(summary).includes(secret));
  assert.ok(!JSON.stringify(summary).includes("DATABASE_URL"));
});

test("nginx evidence is bounded and never declares verified ingress", () => {
  const result = nginxSummary(
    "server_name ayin.stream; # ssl_verify_client on;\nproxy_pass http://secret-upstream; ssl_client_certificate /secret/file; include /etc/nginx/*; deny all; allow 192.0.2.1;",
  );
  assert.equal(result.clientCertificateRequired, false);
  assert.equal(result.clientCertificateConfigured, true);
  assert.equal(result.ingressVerified, false);
  assert.equal(result.allowDirectiveCount, 1);
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!JSON.stringify(result).includes("192.0.2.1"));
  assert.equal(nginxSummary("server_name api.ayin.stream;").referencesWeb, false);
});

test("Cloudflare inspection uses GET only, rejects redirects, and omits DNS targets and header values", async () => {
  const secret = "do-not-disclose-the-edge-credential";
  const calls = [];
  const fake = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, "Bearer " + secret);
    let result = [];
    if (url.includes("/zones?")) result = [{ name: "ayin.stream", id: "a".repeat(32) }];
    else if (url.includes("/settings/")) result = { value: "on" };
    else if (url.includes("dns_records"))
      result = [{ name: "ayin.stream", type: "A", content: secret, proxied: true }];
    else if (url.includes("origin_tls")) result = { enabled: true };
    else result = { rules: [{ action_parameters: { headers: { secret } } }] };
    return { status: 200, json: async () => ({ result }) };
  };
  const summary = await cloudflare(fake, secret);
  assert.equal(calls.length, 8);
  assert.equal(summary.ingressVerified, false);
  assert.ok(!JSON.stringify(summary).includes(secret));
  assert.equal(summary.requestHeaderRules.count, 1);
});

test("missing or denied Cloudflare access remains an explicit unknown", async () => {
  assert.equal((await cloudflare(undefined, "")).credentialAvailable, false);
  const result = await cloudflare(
    async () => ({ status: 403, json: async () => ({ errors: ["secret"] }) }),
    "token",
  );
  assert.deepEqual(result, {
    kind: "ayin-region-edge-read-only",
    zoneReadStatus: 403,
    exactZoneResolved: false,
  });
});
