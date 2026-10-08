import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { BUCKET, CLEANUP_ACK, FIXTURES, PREFIX, RUN_ID } from "./r2-owned-fixture-provider.mjs";
import {
  PLAN,
  validateReady,
  validateGrant,
  performBrowserPut,
  validatePublicProof,
  driveProtocol,
  sshArguments,
} from "./r2-owned-fixture-browser.mjs";

const approval = {
  executeApproved: true,
  runId: RUN_ID,
  prefix: PREFIX,
  cleanupAck: CLEANUP_ACK,
  releaseSha: "a".repeat(40),
};
const origin = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
function grant(seq = 1) {
  const planned = PLAN[seq - 1],
    now = new Date();
  const url = new URL(`${origin}/${BUCKET}/${PREFIX}${planned.fixture}`);
  for (const [key, value] of Object.entries({
    partNumber: String(planned.partNumber),
    uploadId: "private-upload-id",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${"A".repeat(32)}/${now.toISOString().slice(0, 10).replaceAll("-", "")}/auto/s3/aws4_request`,
    "X-Amz-Date": now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
    "X-Amz-Expires": "90",
    "X-Amz-SignedHeaders": "content-length;host",
    "X-Amz-Signature": "1".repeat(64),
  }))
    url.searchParams.set(key, value);
  return {
    type: "grant",
    seq,
    ...planned,
    url: url.href,
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
  };
}
function proof(status = "FAILED") {
  return {
    schema: 1,
    type: "proof",
    runId: RUN_ID,
    releaseSha: approval.releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    observationsOnly: true,
    activationEnabled: false,
    maxRetainedBytes: 10_485_815,
    status,
    stage: "reserved",
    code: "PROVIDER_OR_PROTOCOL_FAILURE",
    fixtures: FIXTURES.map((fixture) => ({
      ...fixture,
      key: PREFIX + fixture.name,
      allocationKnown: false,
      create: "not-dispatched",
      complete: "not-dispatched",
      abort: "not-dispatched",
      deletion: "not-dispatched",
      debt: false,
      stages: [],
    })),
  };
}
function child() {
  const value = new EventEmitter();
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.exitCode = null;
  value.kill = () => {
    value.killed = true;
  };
  return value;
}
const tick = () => new Promise((done) => setImmediate(done));

test("browser default is offline and requires complete explicit approval before Chromium or SSH", () => {
  const result = spawnSync(process.execPath, ["deploy/media/r2-owned-fixture-browser.mjs"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /EXPLICIT_APPROVAL_REQUIRED/);
  assert.equal(result.stderr, "");
  assert.throws(() => sshArguments({ ...approval, releaseSha: "main; cat /secret" }));
});
test("configured provider handshake must be exact trusted R2 origin and release", () => {
  assert.equal(
    validateReady(
      { type: "ready", r2Origin: origin, releaseSha: approval.releaseSha },
      approval.releaseSha,
    ),
    origin,
  );
  for (const r2Origin of [
    "https://evil.example",
    origin + ".evil.example",
    origin + "/",
    "http://" + origin.slice(8),
  ])
    assert.throws(() =>
      validateReady(
        { type: "ready", r2Origin, releaseSha: approval.releaseSha },
        approval.releaseSha,
      ),
    );
});
test("only exact five grants and lengths from the approved key scope pass", () => {
  for (let i = 1; i <= PLAN.length; i++) assert.equal(validateGrant(grant(i), i, origin).seq, i);
  for (const change of [
    { fixture: "actual-user.mp4" },
    { payloadSizeBytes: 37 },
    { offset: 1 },
    { expectedSizeBytes: 37 },
    { partNumber: 2 },
    { seq: 2 },
    { headers: { "Content-Length": "38" } },
    { expiresAt: new Date(0).toISOString() },
  ])
    assert.throws(() => validateGrant({ ...grant(), ...change }, 1, origin));
});
test("grant validation rejects target escapes, unsigned lengths, duplicates, replay and redirects", () => {
  const mutate = (fn) => {
    const g = grant();
    const url = new URL(g.url);
    fn(url);
    g.url = url.href;
    return g;
  };
  for (const bad of [
    mutate((u) => {
      u.hostname = "evil.example";
    }),
    mutate((u) => {
      u.pathname = "/other-bucket/" + PREFIX + "small.bin";
    }),
    mutate((u) => {
      u.pathname = "/" + BUCKET + "/channels/victim/source.mp4";
    }),
    mutate((u) => {
      u.searchParams.set("X-Amz-SignedHeaders", "host");
    }),
    mutate((u) => {
      u.searchParams.append("uploadId", "other");
    }),
    mutate((u) => {
      u.searchParams.set("redirect", "https://evil.example");
    }),
    mutate((u) => {
      u.searchParams.set("X-Amz-Expires", "3600");
    }),
    mutate((u) => {
      u.hash = "secret";
    }),
    mutate((u) => {
      u.username = "secret";
    }),
  ])
    assert.throws(() => validateGrant(bad, 1, origin));
});
test("SSH uses only fixed identity/host, strict pin verification and deployed env file in place", () => {
  const args = sshArguments(approval, "/runner");
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(args.includes("IdentitiesOnly=yes"));
  assert.ok(args.includes("ayin@13.52.116.200"));
  assert.match(args.at(-1), /test ! -w \/home\/horusapp/);
  assert.match(args.at(-1), /deploy\/run-with-env.cjs \/home\/ayin\/env\/api.env/);
  assert.ok(!args.at(-1).includes("cat "));
  assert.ok(!args.at(-1).includes("source "));
});
test("actual Blob fetch omits credentials and Content-Length, while network observation proves browser auto length", async () => {
  const g = grant(),
    oldFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = options;
    assert.equal(url, g.url);
    assert.equal(options.body.size, 39);
    assert.equal(options.body.type, "");
    return new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 });
  };
  const response = { status: () => 403, fromServiceWorker: () => false, url: () => g.url };
  const request = {
    allHeaders: async () => ({ "content-length": "39", origin: "https://ayin.stream" }),
    resourceType: () => "fetch",
    redirectedFrom: () => null,
    response: async () => response,
  };
  const page = {
    url: () => "https://ayin.stream/",
    waitForRequest: async () => request,
    evaluate: async (fn, input) => fn(input),
  };
  try {
    const result = await performBrowserPut(page, g);
    assert.equal(result.status, 403);
    assert.equal(result.errorCode, "SignatureDoesNotMatch");
    assert.equal(observed.headers, undefined);
    assert.equal(observed.credentials, "omit");
    assert.equal(observed.redirect, "error");
    assert.equal(observed.mode, "cors");
    request.allHeaders = async () => ({ "content-length": "38", origin: "https://ayin.stream" });
    await assert.rejects(performBrowserPut(page, g), /NETWORK_HEADERS_NOT_VERIFIED/);
    request.allHeaders = async () => ({
      "content-length": "39",
      origin: "https://ayin.stream",
      cookie: "secret",
    });
    await assert.rejects(performBrowserPut(page, g), /NETWORK_HEADERS_NOT_VERIFIED/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
test("public proof reconstruction excludes unknown fields and upload IDs", () => {
  const p = proof();
  p.url = "https://secret";
  p.fixtures[0].uploadId = "private-id";
  p.fixtures[0].headers = { authorization: "secret" };
  const sanitized = JSON.stringify(validatePublicProof(p, approval.releaseSha));
  assert.ok(!sanitized.includes("secret"));
  assert.ok(!sanitized.includes("private-id"));
  assert.ok(!sanitized.includes("headers"));
  assert.throws(() =>
    validatePublicProof({ ...p, prefix: "channels/private/" }, approval.releaseSha),
  );
});
test("strict protocol consumes bounded trusted ready and sanitized failure proof", async () => {
  const remote = child();
  const promise = driveProtocol(remote, approval, () => {
    throw new Error("unexpected grant");
  });
  remote.stdout.write(
    JSON.stringify({ type: "ready", r2Origin: origin, releaseSha: approval.releaseSha }) + "\n",
  );
  await tick();
  remote.stdout.write(JSON.stringify(proof()) + "\n");
  await tick();
  remote.exitCode = 1;
  remote.emit("close", 1);
  assert.equal((await promise).status, "FAILED");
});
test("oversized private remote output cannot leak through errors or trigger PUT", async () => {
  const remote = child();
  let calls = 0;
  const promise = driveProtocol(remote, approval, () => {
    calls++;
  });
  remote.stdout.write("SECRET_GRANT".repeat(2000));
  await assert.rejects(promise, /REMOTE_ACCEPTANCE_FAILED/);
  assert.equal(calls, 0);
  assert.ok(remote.killed);
});
test("unexpected EOF and a stalled remote are bounded without replay", async () => {
  const remote = child();
  const promise = driveProtocol(remote, approval, () => undefined, { timeoutMs: 20 });
  await assert.rejects(promise, /BOUNDED_TIMEOUT/);
  assert.ok(remote.killed);
  const ended = child();
  const closing = driveProtocol(ended, approval, () => undefined);
  ended.exitCode = 1;
  ended.emit("close", 1);
  await assert.rejects(closing, /REMOTE_ACCEPTANCE_FAILED/);
});
test("workflow remains manual-only, main/deployed-gated, no production bootstrap or provider secrets", () => {
  const text = readFileSync(".github/workflows/r2-owned-fixture-acceptance.yml", "utf8");
  assert.match(text, /workflow_dispatch:/);
  assert.ok(!/^ {2}(push|pull_request|workflow_run):/m.test(text));
  assert.match(text, /github.ref == 'refs\/heads\/main'/);
  assert.match(text, /GITHUB_RUN_ATTEMPT/);
  assert.match(text, /SHA256:YoUNEx7Aizhzl99TReL4kGCyUY6KopzrPuPgRmhDC0Y/);
  assert.match(text, /AYIN_DEPLOY_SSH_KEY/);
  assert.ok(!text.includes("secrets.R2"));
  assert.ok(!text.includes("bootstrap-r2"));
  assert.match(text, /\['database.yml', 'Task quality gates'\]/);
  assert.match(text, /\['deploy.yml', 'Production deployment'\]/);
});

test("JSONL accepts coalesced ready/grant and split frames without assuming TCP chunk boundaries", async () => {
  const remote = child();
  let calls = 0;
  const run = driveProtocol(remote, approval, async (g) => {
    calls++;
    return {
      type: "put-result",
      seq: g.seq,
      outcome: "http",
      status: 403,
      errorCode: "SignatureDoesNotMatch",
    };
  });
  const first =
    JSON.stringify({ type: "ready", r2Origin: origin, releaseSha: approval.releaseSha }) +
    "\n" +
    JSON.stringify(grant()) +
    "\n";
  remote.stdout.write(first.slice(0, 31));
  remote.stdout.write(first.slice(31));
  await tick();
  const last = JSON.stringify(proof()) + "\n";
  remote.stdout.write(last.slice(0, 5));
  remote.stdout.write(last.slice(5));
  await tick();
  remote.exitCode = 1;
  remote.emit("close", 1);
  assert.equal((await run).status, "FAILED");
  assert.equal(calls, 1);
});
test("JSONL rejects two unsolicited/coalesced grants and out-of-order grant sequence", async () => {
  for (const messages of [[grant(), grant(2)], [grant(2)]]) {
    const remote = child();
    const run = driveProtocol(remote, approval, () => new Promise(() => undefined));
    remote.stdout.write(
      JSON.stringify({ type: "ready", r2Origin: origin, releaseSha: approval.releaseSha }) + "\n",
    );
    await tick();
    remote.stdout.write(messages.map((g) => JSON.stringify(g) + "\n").join(""));
    await assert.rejects(run, /REMOTE_ACCEPTANCE_FAILED/);
    assert.ok(remote.killed);
  }
});
test("successful proof cannot omit required receipt, payload, cleanup or negative-control observations", () => {
  assert.throws(
    () => validatePublicProof(proof("OBSERVATIONS_PASSED"), approval.releaseSha),
    /INCOMPLETE_SUCCESS_PROOF/,
  );
});
test("positive browser PUT requires a browser-visible ETag but never returns it as a completion input", async () => {
  const g = grant(2),
    oldFetch = globalThis.fetch;
  const request = {
    allHeaders: async () => ({ "content-length": "38", origin: "https://ayin.stream" }),
    resourceType: () => "fetch",
    redirectedFrom: () => null,
    response: async () => ({ status: () => 200, fromServiceWorker: () => false, url: () => g.url }),
  };
  const page = {
    url: () => "https://ayin.stream/",
    waitForRequest: async () => request,
    evaluate: async (fn, input) => fn(input),
  };
  try {
    globalThis.fetch = async () =>
      new Response(null, { status: 200, headers: { etag: '"browser-visible-etag"' } });
    const result = await performBrowserPut(page, g);
    assert.equal(result.status, 200);
    assert.ok(!Object.hasOwn(result, "etag"));
    globalThis.fetch = async () => new Response(null, { status: 200 });
    await assert.rejects(performBrowserPut(page, g), /NETWORK_RESPONSE_NOT_VERIFIED/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
