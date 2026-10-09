import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  BUCKET,
  CLEANUP_ACK,
  FIXTURES,
  PREFIX,
  RUN_ID,
  LINE_BYTES,
} from "./r2-owned-fixture-provider.mjs";
import { performBrowserPut } from "./r2-owned-fixture-browser.mjs";
import {
  CONTINUATION_ID,
  ORIGINAL_MANIFEST_SHA256,
  ORIGINAL_RELEASE_SHA,
  toolingFileHashes,
} from "./r2-owned-continuation-provider.mjs";
import {
  PLAN,
  validateContinuationGrant,
  driveProtocol,
  runBrowserContinuation,
  sshArguments,
  driverFailureSummary,
} from "./r2-owned-continuation-browser.mjs";

const approval = {
  executeApproved: true,
  executeContinuationApproved: true,
  runId: RUN_ID,
  prefix: PREFIX,
  cleanupAck: CLEANUP_ACK,
  releaseSha: ORIGINAL_RELEASE_SHA,
  toolingSha: "b".repeat(40),
};
const origin = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
const toolingFiles = toolingFileHashes();
const ready = {
  type: "ready",
  r2Origin: origin,
  releaseSha: approval.releaseSha,
};
const tick = () => new Promise((done) => setImmediate(done));
function grant(seq = 1) {
  const planned = PLAN[seq - 1],
    now = new Date();
  const url = new URL(`${origin}/${BUCKET}/${PREFIX}${planned.fixture}`);
  for (const [key, value] of Object.entries({
    partNumber: String(planned.partNumber),
    uploadId: "PRIVATE_UPLOAD_ID",
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
    type: "continuation-proof",
    continuationId: CONTINUATION_ID,
    originalManifestSha256: ORIGINAL_MANIFEST_SHA256,
    originalStatus: "FAILED",
    toolingSha: approval.toolingSha,
    toolingFiles,
    singlePartCompletionCovered: false,
    postCutoffAbsenceObserved: status === "OBSERVATIONS_PASSED",
    runId: RUN_ID,
    releaseSha: approval.releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    observationsOnly: true,
    activationEnabled: false,
    maxRetainedBytes: 10_485_815,
    status,
    stage: "reserved",
    code: status === "FAILED" ? "PROVIDER_OR_PROTOCOL_FAILURE" : null,
    fixtures: FIXTURES.slice(1).map((fixture) => ({
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
function successProof() {
  const p = proof("OBSERVATIONS_PASSED");
  p.stage = "post-grant-cutoff-absence-observed";
  for (const fixture of p.fixtures) {
    fixture.allocationKnown = true;
    fixture.create = "acknowledged";
  }
  Object.assign(p.fixtures[0], {
    complete: "acknowledged-receipt-discarded",
    deletion: "acknowledged",
    stages: [
      "wrong-length-provider-rejected-with-no-part",
      "part-1-put-dispatched",
      "part-2-put-dispatched",
      "resume-authoritative-part-one-observed",
      "direct-get-sha256-and-ayin-root-verified",
      "owned-object-deletion-and-absence-observed",
      "post-grant-cutoff-absence-observed",
    ],
  });
  Object.assign(p.fixtures[1], {
    abort: "acknowledged",
    stages: [
      "part-1-put-dispatched",
      "abort-and-absence-observed",
      "post-grant-cutoff-absence-observed",
    ],
  });
  return p;
}
function child() {
  const remote = new EventEmitter();
  remote.stdin = new PassThrough();
  remote.stdout = new PassThrough();
  remote.stderr = new PassThrough();
  remote.exitCode = null;
  remote.kill = () => {
    remote.killed = true;
  };
  return remote;
}
function send(remote, ...messages) {
  remote.stdout.write(messages.map((message) => JSON.stringify(message) + "\n").join(""));
}
function close(remote, code) {
  remote.exitCode = code;
  remote.emit("close", code);
}
function reply(g) {
  return {
    type: "put-result",
    seq: g.seq,
    outcome: "http",
    status: 200,
    errorCode: null,
  };
}

test("continuation refuses default/old approval and uses only its fixed SSH command", () => {
  const result = spawnSync(process.execPath, ["deploy/media/r2-owned-continuation-browser.mjs"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /phase=approval code=EXPLICIT_(CONTINUATION_)?APPROVAL_REQUIRED/);
  assert.equal(result.stderr, "");
  assert.throws(() => sshArguments({ ...approval, executeContinuationApproved: false }));
  assert.throws(() => sshArguments({ ...approval, releaseSha: "main; cat /SECRET" }));
  assert.throws(() => sshArguments({ ...approval, toolingSha: "main; cat /SECRET" }));
  const args = sshArguments(approval, "/runner");
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(args.includes("IdentitiesOnly=yes"));
  assert.ok(args.includes("ayin@13.52.116.200"));
  assert.match(
    args.at(-1),
    /r2-owned-continuation-provider\.mjs --execute-approved --execute-continuation-approved /,
  );
  assert.ok(
    args
      .at(-1)
      .includes(
        `/home/ayin/.r2-acceptance-tooling/${approval.toolingSha}/r2-owned-continuation-provider.mjs`,
      ),
  );
  assert.ok(args.at(-1).endsWith(`--tooling-sha ${approval.toolingSha}`));
  assert.doesNotMatch(args.at(-1), /r2-owned-fixture-provider\.mjs|retry|rerun/);
});

test("only three remaining positive grants pass; small fixture and original sequence numbers fail", () => {
  assert.deepEqual(
    PLAN.map(({ fixture, partNumber, payloadSizeBytes, offset }) => [
      fixture,
      partNumber,
      payloadSizeBytes,
      offset,
    ]),
    [
      ["multipart.bin", 1, 5_242_880, 0],
      ["multipart.bin", 2, 17, 5_242_880],
      ["abort.bin", 1, 5_242_880, 0],
    ],
  );
  for (let seq = 1; seq <= 3; seq++)
    assert.equal(validateContinuationGrant(grant(seq), seq, origin).seq, seq);
  for (const change of [
    { seq: 3 },
    { seq: 4 },
    { fixture: "small.bin" },
    { payloadSizeBytes: 39 },
    { expectedSizeBytes: 38 },
    { offset: 1 },
    { partNumber: 2 },
    { url: "https://SECRET/" },
    { extra: "PRIVATE" },
  ])
    assert.throws(() => validateContinuationGrant({ ...grant(), ...change }, 1, origin));
  assert.throws(() => validateContinuationGrant({ ...grant(), seq: 4 }, 4, origin));
});

test("exact three positive replies, cleanup proof and exit0 complete with original failure preserved", async () => {
  const remote = child(),
    seen = [];
  const run = driveProtocol(remote, approval, async (g) => {
    seen.push(g.seq);
    return reply(g);
  });
  const start = JSON.stringify(ready) + "\n" + JSON.stringify(grant()) + "\n";
  remote.stdout.write(start.slice(0, 31));
  remote.stdout.write(start.slice(31));
  await tick();
  send(remote, grant(2));
  await tick();
  send(remote, grant(3));
  await tick();
  send(remote, successProof());
  await tick();
  let settled = false;
  void run.then(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false, "proof alone cannot pass before process exit");
  close(remote, 0);
  const result = await run;
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(result.originalStatus, "FAILED");
  assert.equal(result.status, "OBSERVATIONS_PASSED");
  assert.deepEqual(
    result.fixtures.map((f) => f.name),
    ["multipart.bin", "abort.bin"],
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|uploadId|small\.bin|Signature/);
});

test("coalesced grants, replay, extra grant and proof before reply stop without further PUTs", async () => {
  for (const scenario of ["coalesced", "replay", "extra", "early-proof"]) {
    const remote = child();
    let calls = 0,
      release;
    const run = driveProtocol(remote, approval, async (g) => {
      calls++;
      if (scenario === "early-proof")
        await new Promise((done) => {
          release = done;
        });
      return reply(g);
    });
    const expected = assert.rejects(run);
    send(remote, ready);
    if (scenario === "coalesced") send(remote, grant(), grant(2));
    else {
      send(remote, grant());
      await tick();
      if (scenario === "replay") send(remote, grant());
      else if (scenario === "early-proof") send(remote, proof());
      else {
        send(remote, grant(2));
        await tick();
        send(remote, grant(3));
        await tick();
        send(remote, { ...grant(3), seq: 4 });
      }
    }
    await expected;
    release?.();
    send(remote, grant(2));
    await tick();
    assert.equal(calls, scenario === "coalesced" ? 0 : scenario === "extra" ? 3 : 1);
    assert.ok(remote.killed);
  }
});

test("timeout or EOF while PUT is pending prevents reply and late grants", async () => {
  for (const interrupted of ["timeout", "close"]) {
    const remote = child();
    let release,
      calls = 0;
    const run = driveProtocol(
      remote,
      approval,
      async (g) => {
        calls++;
        await new Promise((done) => {
          release = done;
        });
        return reply(g);
      },
      { timeoutMs: 25 },
    );
    const expected = assert.rejects(run, {
      code: interrupted === "timeout" ? "BOUNDED_TIMEOUT" : "REMOTE_PIPE_CLOSED",
    });
    send(remote, ready, grant());
    await tick();
    if (interrupted === "close") close(remote, 1);
    await expected;
    release();
    send(remote, grant(2));
    await tick();
    assert.equal(calls, 1);
    assert.equal(remote.stdin.readableLength, 0);
    assert.ok(remote.killed);
  }
});

test("success cannot precede all grants, replace cleanup proof, ignore exit failure or accept late frames", async () => {
  for (const scenario of [
    "early-success",
    "missing-cleanup",
    "unfinished-stage",
    "bad-exit",
    "late-frame",
    "nonpositive",
  ]) {
    const remote = child();
    const run = driveProtocol(remote, approval, async (g) => ({
      ...reply(g),
      status: scenario === "nonpositive" && g.seq === 2 ? 403 : 200,
    }));
    const expected = assert.rejects(run);
    send(remote, ready);
    if (scenario !== "early-success")
      for (let seq = 1; seq <= 3; seq++) {
        send(remote, grant(seq));
        await tick();
      }
    const p = successProof();
    if (scenario === "missing-cleanup") p.fixtures[0].deletion = "not-dispatched";
    if (scenario === "unfinished-stage") p.stage = "reserved";
    send(remote, p);
    await tick();
    if (scenario === "late-frame") send(remote, grant());
    close(remote, scenario === "bad-exit" ? 1 : 0);
    await expected;
  }
});

test("private malformed input, stderr limits and raw SSH failures retain only safe diagnostics", async () => {
  const secret = Object.assign(new Error("https://SECRET/?X-Amz-Signature=PRIVATE payload"), {
    code: "SECRET_CODE",
    phase: "PRIVATE_PHASE",
  });
  for (const scenario of ["malformed", "stderr", "line", "ssh", "reply"]) {
    const remote = child();
    const run = driveProtocol(remote, approval, async (g) => ({
      ...reply(g),
      url: "https://SECRET/",
    }));
    const expected = assert.rejects(run, (error) => {
      assert.doesNotMatch(
        String(error) + JSON.stringify(error) + JSON.stringify(driverFailureSummary(error)),
        /SECRET|PRIVATE|https:|payload/,
      );
      assert.equal(error.cause, undefined);
      return true;
    });
    if (scenario === "malformed") remote.stdout.write("SECRET_NOT_JSON\n");
    if (scenario === "stderr") remote.stderr.write("PRIVATE".repeat(LINE_BYTES));
    if (scenario === "line") remote.stdout.write("SECRET".repeat(LINE_BYTES));
    if (scenario === "ssh") remote.emit("error", secret);
    if (scenario === "reply") send(remote, ready, grant());
    await expected;
    assert.ok(remote.killed);
  }
  assert.deepEqual(driverFailureSummary(secret), {
    phase: "driver",
    code: "PROVIDER_OR_PROTOCOL_FAILURE",
  });
});

test("existing browser failure observations survive with no raw headers or URLs", async () => {
  const remote = child();
  const run = driveProtocol(remote, approval, async (g) =>
    performBrowserPut(
      {
        url: () => "https://ayin.stream/",
        evaluate: async () => ({ outcome: "network-error", status: null }),
        waitForRequest: async () => ({
          allHeaders: async () => ({
            "content-length": String(g.payloadSizeBytes),
            origin: "https://ayin.stream",
          }),
          resourceType: () => "fetch",
          redirectedFrom: () => null,
          response: async () => ({
            status: () => 403,
            fromServiceWorker: () => false,
            url: () => g.url,
            headers: () => ({
              "access-control-allow-origin": "https://SECRET",
              "set-cookie": "PRIVATE",
            }),
          }),
        }),
      },
      g,
    ),
  );
  send(remote, ready, grant());
  await assert.rejects(run, (error) => {
    assert.deepEqual(driverFailureSummary(error), {
      phase: "browser-response",
      code: "BROWSER_NETWORK_RESPONSE_NOT_VERIFIED",
      browser: {
        outcome: "network-error",
        pageStatus: null,
        networkStatus: 403,
        corsOriginHeaderMatches: false,
      },
    });
    assert.doesNotMatch(JSON.stringify(error), /SECRET|PRIVATE|https:/);
    return true;
  });
});

test("browser context is replaced only before multipart part2, with all three PUTs from AYIN", async () => {
  const remote = child(),
    contexts = [],
    seen = [];
  let browserClosed = false;
  const chromium = {
    launch: async () => ({
      close: async () => {
        browserClosed = true;
      },
      newContext: async (options) => {
        assert.deepEqual(options, { serviceWorkers: "block" });
        const context = {
          closed: false,
          close: async () => {
            context.closed = true;
          },
        };
        contexts.push(context);
        let current;
        context.newPage = async () => ({
          url: () => "https://ayin.stream/",
          goto: async () => ({ status: () => 200 }),
          evaluate: async (_fn, g) => {
            current = g;
            seen.push([g.seq, contexts.indexOf(context)]);
            if (g.seq >= 2) assert.equal(contexts[0].closed, true);
            return reply(g);
          },
          waitForRequest: async () => ({
            allHeaders: async () => ({
              "content-length": String(current.payloadSizeBytes),
              origin: "https://ayin.stream",
            }),
            resourceType: () => "fetch",
            redirectedFrom: () => null,
            response: async () => ({
              status: () => 200,
              fromServiceWorker: () => false,
              url: () => current.url,
              headers: () => ({
                "access-control-allow-origin": "https://ayin.stream",
              }),
            }),
          }),
        });
        return context;
      },
    }),
  };
  remote.stdin.on("data", (line) => {
    const value = JSON.parse(line);
    queueMicrotask(() => {
      if (value.seq < 3) send(remote, grant(value.seq + 1));
      else {
        send(remote, successProof());
        setImmediate(() => close(remote, 0));
      }
    });
  });
  const result = await runBrowserContinuation(approval, chromium, {
    spawnProcess: () => {
      queueMicrotask(() => send(remote, ready, grant()));
      return remote;
    },
  });
  assert.deepEqual(seen, [
    [1, 0],
    [2, 1],
    [3, 1],
  ]);
  assert.equal(contexts.length, 2);
  assert.equal(browserClosed, true);
  assert.equal(result.originalStatus, "FAILED");
});

test("whole browser startup deadline prevents a late navigation from spawning SSH", async () => {
  let release,
    closed = 0,
    spawns = 0;
  const chromium = {
    launch: async () => ({
      close: async () => {
        closed++;
      },
      newContext: async () => ({
        newPage: async () => ({
          goto: async () =>
            new Promise((done) => {
              release = () => done({ status: () => 200 });
            }),
          url: () => "https://ayin.stream/",
        }),
      }),
    }),
  };
  const run = runBrowserContinuation(approval, chromium, {
    timeoutMs: 25,
    spawnProcess: () => {
      spawns++;
      throw new Error("SECRET");
    },
  });
  await assert.rejects(run, { code: "BOUNDED_TIMEOUT" });
  release();
  await tick();
  assert.equal(spawns, 0);
  assert.ok(closed > 0);
});

test("SSH spawn errors are observed synchronously and never print private child arguments", () => {
  const script = `
    import { spawn } from "node:child_process";
    import { driveSsh, driverFailureSummary } from "./deploy/media/r2-owned-continuation-browser.mjs";
    await driveSsh(${JSON.stringify(approval)}, () => {},
      () => spawn(process.execPath + ".missing-continuation", ["SYNTHETIC_PRIVATE_ARGUMENT"]))
      .catch((error) => { process.stdout.write(JSON.stringify(driverFailureSummary(error))); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    phase: "ssh",
    code: "PROVIDER_OR_PROTOCOL_FAILURE",
  });
});
