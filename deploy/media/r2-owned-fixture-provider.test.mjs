import { test } from "node:test";
import * as fs from "node:fs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  ORIGINAL_RELEASE_SHA,
  ORIGINAL_MANIFEST_SHA256,
  CONTINUATION_FILENAME,
  validatePredecessor,
  readPredecessorManifest,
  createDirectNegativeProbe,
  runContinuation,
  validateContinuationProof,
  toolingFileHashes,
} from "./r2-owned-continuation-provider.mjs";
import {
  BUCKET,
  CLEANUP_ACK,
  FIXTURES,
  PART_BYTES,
  PREFIX,
  RUN_ID,
  createManifest,
  fixtureBytes,
  identityRoot,
  sha256,
  bounded,
  readBodyBounded,
  makeJsonlChannel,
  runAcceptance,
  validateApproval,
  verifySignatureCapability,
} from "./r2-owned-fixture-provider.mjs";

export const approval = {
  executeApproved: true,
  runId: RUN_ID,
  prefix: PREFIX,
  cleanupAck: CLEANUP_ACK,
  releaseSha: "a".repeat(40),
};
export function signedGrant(input) {
  if (!input.expectedSizeBytes) throw new Error("invalid");
  const now = input.now ?? new Date();
  const url = new URL(`https://${"a".repeat(32)}.r2.cloudflarestorage.com/${BUCKET}/${input.key}`);
  for (const [key, value] of Object.entries({
    partNumber: String(input.partNumber),
    uploadId: input.uploadId,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${"A".repeat(32)}/${now.toISOString().slice(0, 10).replaceAll("-", "")}/auto/s3/aws4_request`,
    "X-Amz-Date": now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
    "X-Amz-Expires": "90",
    "X-Amz-SignedHeaders": "content-length;host",
    "X-Amz-Signature": String(input.expectedSizeBytes % 9).repeat(64),
  }))
    url.searchParams.set(key, value);
  return { url: url.href, expiresAt: new Date(now.getTime() + 90_000) };
}
function missingObject() {
  return Object.assign(new Error("private provider diagnostic https://SECRET"), {
    method: "HEAD",
    status: 404,
  });
}
function missingUpload() {
  return Object.assign(new Error("private upload ID"), {
    code: "NO_SUCH_UPLOAD",
    operation: "listParts",
    providerStatus: 404,
  });
}
export function fakeRuntime(options = {}) {
  const calls = [],
    uploads = new Map(),
    objects = new Map();
  let count = 0;
  const storage = {
    authorizeMultipartPart: async (input) => signedGrant(input),
    createMultipartUpload: async (input) => {
      calls.push(["create", input.key]);
      count++;
      const uploadId = `private-upload-id-${count}`;
      uploads.set(uploadId, { ...input, parts: [] });
      if (options.unknownCreate)
        throw new Error("SECRET_SIGNED_URL=https://secret/?credential=private");
      return { uploadId };
    },
    listParts: async ({ key, uploadId }) => {
      calls.push(["parts", key]);
      if (!uploads.has(uploadId)) throw missingUpload();
      return uploads.get(uploadId).parts;
    },
    headObject: async (key) => {
      calls.push(["head", key]);
      if (options.preexisting === key) return {};
      if (!objects.has(key)) throw missingObject();
      return objects.get(key).metadata;
    },
    completeMultipartUpload: async ({ key, uploadId, parts }) => {
      calls.push(["complete", key, parts]);
      assert.ok(parts.every((part) => part.etag.startsWith("provider-etag-")));
      const upload = uploads.get(uploadId);
      uploads.delete(uploadId);
      const size = FIXTURES.find((f) => PREFIX + f.name === key).size;
      objects.set(key, {
        bytes: fixtureBytes(size),
        metadata: {
          sizeBytes: size,
          contentType: "application/octet-stream",
          uploadBinding: upload.uploadBinding,
          etag: '"provider-object"',
        },
      });
      if (options.unknownComplete) throw new Error("private complete diagnostic");
      return { etag: "deliberately-untrusted-receipt" };
    },
    observeUploadCompletion: async ({ key, uploadId, expected }) => {
      calls.push(["observe", key]);
      if (uploads.has(uploadId)) return { status: "MULTIPART_PRESENT" };
      const object = objects.get(key);
      if (!object) return { status: "OBJECT_ABSENT" };
      if (
        options.mismatch ||
        object.metadata.uploadBinding.contentIdentityDigest !==
          expected.binding.contentIdentityDigest
      )
        return { status: "OBJECT_MISMATCH" };
      return { status: "OBJECT_VERIFIED", metadata: object.metadata };
    },
    abortMultipartUpload: async ({ key, uploadId }) => {
      calls.push(["abort", key, uploadId]);
      if (options.unknownAbort) throw new Error("private abort failure");
      uploads.delete(uploadId);
    },
    deleteObject: async (key) => {
      calls.push(["delete", key]);
      if (options.unknownDelete) throw new Error("private delete failure");
      objects.delete(key);
    },
  };
  const runtime = {
    storage,
    assertNoExistingAllocation: async (key) => {
      calls.push(["collision", key]);
      if (options.preexistingAllocation === key) throw new Error("foreign key from provider");
    },
    identity: async (bytes) => identityRoot(bytes),
    getExact: async (key) => {
      calls.push(["get", key]);
      const bytes = objects.get(key).bytes;
      return options.corruptRead ? Buffer.alloc(bytes.length) : bytes;
    },
  };
  const browser = async (grant) => {
    calls.push(["browser", grant.fixture, grant.partNumber, grant.payloadSizeBytes]);
    if (options.browserHang) return new Promise(() => undefined);
    if (grant.payloadSizeBytes !== grant.expectedSizeBytes) {
      return {
        type: "put-result",
        seq: grant.seq,
        outcome: "http",
        status: options.wrongLengthAccepted ? 200 : 403,
        errorCode: options.wrongLengthAccepted ? null : "SignatureDoesNotMatch",
      };
    }
    const upload = uploads.get(new URL(grant.url).searchParams.get("uploadId"));
    upload.parts.push({
      partNumber: grant.partNumber,
      sizeBytes: grant.payloadSizeBytes,
      etag: `provider-etag-${grant.partNumber}`,
    });
    return { type: "put-result", seq: grant.seq, outcome: "http", status: 200, errorCode: null };
  };
  return { runtime, browser, calls, objects, uploads };
}
function temp(t) {
  const directory = mkdtempSync(join(tmpdir(), "owned-r2-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "manifests");
}
async function run(t, config = {}, extras = {}) {
  const directory = temp(t),
    fake = fakeRuntime(config);
  const proof = await runAcceptance(approval, {
    ...fake,
    directory,
    dispatchSpacingMs: 0,
    ...extras,
  });
  return {
    ...fake,
    proof,
    directory,
    manifest: JSON.parse(readFileSync(join(directory, RUN_ID + ".json"), "utf8")),
  };
}

test("default CLI and malformed scope perform no provider calls or execution", () => {
  for (const args of [[], ["--execute-approved"], ["--bogus"]]) {
    const result = spawnSync(
      process.execPath,
      ["deploy/media/r2-owned-fixture-provider.mjs", ...args],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /EXPLICIT_APPROVAL_REQUIRED|FIXED_SCOPE_REQUIRED|INVALID_ARGUMENTS/,
    );
    assert.equal(result.stderr, "");
  }
  for (const change of [
    { runId: "other" },
    { prefix: "channels/victim/" },
    { cleanupAck: "yes" },
    { releaseSha: "main; leak" },
    { executeApproved: false },
  ])
    assert.throws(() => validateApproval({ ...approval, ...change }));
});
test("manifest reservation is exclusive, durable, private and permanently blocks replay", (t) => {
  const directory = temp(t);
  const journal = createManifest(approval, directory);
  journal.document.status = "FAILED";
  journal.save();
  assert.equal(JSON.parse(readFileSync(join(directory, RUN_ID + ".json"))).status, "FAILED");
  assert.throws(() => createManifest(approval, directory), /ALREADY_RESERVED/);
});
test("all exact object keys and allocation collisions are checked before creating", async (t) => {
  for (const fixture of FIXTURES) {
    for (const field of ["preexisting", "preexistingAllocation"]) {
      const result = await run(t, { [field]: PREFIX + fixture.name });
      assert.equal(result.proof.status, "FAILED");
      assert.equal(
        result.calls.filter(([name]) => ["create", "abort", "delete", "complete"].includes(name))
          .length,
        0,
      );
    }
  }
});
test("old deployed adapter without exact-length binding fails before provider I/O", async (t) => {
  const fake = fakeRuntime();
  fake.runtime.storage.authorizeMultipartPart = async (input) => {
    const grant = signedGrant({ ...input, expectedSizeBytes: 38 });
    const url = new URL(grant.url);
    url.searchParams.set("X-Amz-SignedHeaders", "host");
    return { ...grant, url: url.href };
  };
  const proof = await runAcceptance(approval, {
    ...fake,
    directory: temp(t),
    dispatchSpacingMs: 0,
  });
  assert.equal(proof.code, "DEPLOYED_EXACT_LENGTH_SIGNING_MISSING");
  assert.deepEqual(fake.calls, []);
});
test("signature capability also requires length-dependent signature and invalid-size rejection", async () => {
  const storage = fakeRuntime().runtime.storage;
  storage.authorizeMultipartPart = async (input) =>
    signedGrant({ ...input, expectedSizeBytes: 38 });
  await assert.rejects(verifySignatureCapability(storage), /EXACT_LENGTH_SIGNING/);
});
test("three multipart allocations, authoritative resume/completion, lost receipt observation, exact readback and cleanup", async (t) => {
  const result = await run(t);
  assert.equal(result.proof.status, "OBSERVATIONS_PASSED");
  assert.equal(result.calls.filter(([name]) => name === "create").length, 3);
  assert.equal(result.calls.filter(([name]) => name === "complete").length, 2);
  assert.equal(result.calls.filter(([name]) => name === "abort").length, 1);
  assert.deepEqual(
    result.calls.filter(([name]) => name === "delete").map(([, key]) => key),
    [PREFIX + "small.bin", PREFIX + "multipart.bin"],
  );
  assert.deepEqual(
    result.calls.filter(([name]) => name === "browser").map(([, , , bytes]) => bytes),
    [39, 38, PART_BYTES, 17, PART_BYTES],
  );
  assert.equal(result.proof.fixtures[1].complete, "acknowledged-receipt-discarded");
  assert.ok(result.proof.fixtures.every((fixture) => !fixture.debt));
  assert.equal(result.objects.size, 0);
  assert.equal(result.uploads.size, 0);
  assert.ok(existsSync(join(result.directory, RUN_ID + ".json")));
  assert.ok(!JSON.stringify(result.proof).includes("private-upload-id"));
  assert.ok(!JSON.stringify(result.proof).includes("X-Amz"));
});
test("unknown create retains debt and performs no guessed cleanup or extra allocation", async (t) => {
  const result = await run(t, { unknownCreate: true });
  assert.equal(result.proof.status, "FAILED");
  assert.equal(result.manifest.fixtures[0].create, "dispatched-unknown");
  assert.equal(result.manifest.fixtures[0].uploadId, null);
  assert.equal(result.manifest.fixtures[0].debt, true);
  assert.equal(
    result.calls.filter(([name]) => ["create", "complete", "abort", "delete"].includes(name))
      .length,
    1,
  );
  assert.ok(!JSON.stringify(result.proof).includes("SECRET"));
  assert.ok(!JSON.stringify(result.manifest).includes("https://secret"));
});
test("unknown Complete remains debt with no replay, abort, deletion or second fixture", async (t) => {
  const result = await run(t, { unknownComplete: true });
  assert.equal(result.manifest.fixtures[0].complete, "dispatched-unknown");
  assert.equal(result.manifest.fixtures[0].debt, true);
  assert.equal(result.calls.filter(([name]) => name === "complete").length, 1);
  assert.equal(result.calls.filter(([name]) => ["abort", "delete"].includes(name)).length, 0);
  assert.equal(result.calls.filter(([name]) => name === "create").length, 1);
});
test("failed negative control cannot continue and aborts only its known allocation", async (t) => {
  const result = await run(t, { wrongLengthAccepted: true });
  assert.equal(result.proof.code, "EXACT_LENGTH_REJECTION_NOT_PROVEN");
  assert.equal(result.calls.filter(([name]) => name === "abort").length, 1);
  assert.equal(result.calls.filter(([name]) => ["complete", "delete"].includes(name)).length, 0);
});
test("unknown abort/deletion are retained and never retried", async (t) => {
  const aborted = await run(t, { wrongLengthAccepted: true, unknownAbort: true });
  assert.equal(aborted.proof.fixtures[0].abort, "dispatched-unknown");
  assert.equal(aborted.proof.fixtures[0].debt, true);
  assert.equal(aborted.calls.filter(([name]) => name === "abort").length, 1);
  const deleted = await run(t, { unknownDelete: true });
  assert.equal(deleted.proof.fixtures[0].deletion, "dispatched-unknown");
  assert.equal(deleted.proof.fixtures[0].debt, true);
  assert.equal(
    deleted.calls.filter(([name, key]) => name === "delete" && key === PREFIX + "small.bin").length,
    1,
  );
});
test("mismatched completion ownership forbids object deletion", async (t) => {
  const result = await run(t, { mismatch: true });
  assert.equal(result.calls.filter(([name]) => name === "delete").length, 0);
  assert.equal(result.proof.fixtures[0].debt, true);
});
test("full readback SHA256 and AYIN root reject equal-sized corrupt data", async (t) => {
  const result = await run(t, { corruptRead: true });
  assert.equal(result.proof.code, "DIRECT_READBACK_IDENTITY_MISMATCH");
});
test("hung browser and uncooperative work are bounded and known allocation cleanup remains scoped", async (t) => {
  const start = Date.now();
  await assert.rejects(
    bounded(() => new Promise(() => undefined), 10),
    /BOUNDED_TIMEOUT/,
  );
  const result = await run(t, { browserHang: true }, { timeoutMs: 10 });
  assert.equal(result.proof.code, "BOUNDED_TIMEOUT");
  assert.equal(result.calls.filter(([name]) => name === "abort").length, 1);
  assert.ok(Date.now() - start < 2000);
});
test("response bodies reject oversized chunks and stalled reads by deadline", async () => {
  await assert.rejects(
    bounded((signal) => readBodyBounded(new Response("too large"), 3, signal), 100),
    /RESPONSE_BYTE_LIMIT/,
  );
  await assert.rejects(
    bounded(
      (signal) =>
        readBodyBounded(
          new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })),
          10,
          signal,
        ),
      10,
    ),
    /BOUNDED_TIMEOUT/,
  );
});
test("stdio accepts only one bounded JSON reply and never echoes raw content", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const channel = makeJsonlChannel(input, output);
  const pending = channel({ type: "grant" });
  await new Promise((done) => setImmediate(done));
  input.write(
    JSON.stringify({ type: "put-result", seq: 1, outcome: "http", status: 200, errorCode: null }) +
      "\n",
  );
  assert.equal((await pending).status, 200);
  const bad = channel({ type: "grant" });
  await new Promise((done) => setImmediate(done));
  input.write("SECRET".repeat(3000));
  await assert.rejects(bad, /STDIO_PROTOCOL_FAILED/);
});
test("fixture byte oracle and identities are deterministic, not ETags or sampled hashes", () => {
  const bytes = fixtureBytes(PART_BYTES + 17);
  assert.deepEqual(bytes.subarray(PART_BYTES), fixtureBytes(17, PART_BYTES));
  assert.notEqual(identityRoot(bytes), sha256(bytes));
  const original = identityRoot(bytes);
  bytes[PART_BYTES - 1] ^= 1;
  assert.notEqual(identityRoot(bytes), original);
});

test("bare NoSuchUpload code, wrong operation and missing 404 do not establish abort absence", async (t) => {
  for (const error of [
    { code: "NO_SUCH_UPLOAD" },
    { code: "NO_SUCH_UPLOAD", operation: "observeUploadCompletion", providerStatus: 404 },
    { code: "NO_SUCH_UPLOAD", operation: "listParts", providerStatus: 500 },
  ]) {
    const fake = fakeRuntime({ wrongLengthAccepted: true });
    fake.runtime.storage.listParts = async () => {
      throw error;
    };
    const result = await runAcceptance(approval, {
      ...fake,
      directory: temp(t),
      dispatchSpacingMs: 0,
    });
    assert.equal(result.fixtures[0].debt, true);
    assert.ok(!result.fixtures[0].stages.includes("abort-and-absence-observed"));
  }
});
test("provider transport refuses foreign targets, redirects and over-budget control calls", async () => {
  const { createBoundedProviderFetch } = await import("./r2-owned-fixture-provider.mjs");
  const origin = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
  const calls = [];
  const fetch = createBoundedProviderFetch(origin, async (url, options) => {
    calls.push([url, options]);
    return new Response(null, { status: 200 });
  });
  for (const url of [
    `https://evil.example/${BUCKET}/${PREFIX}small.bin`,
    `${origin}/${BUCKET}/channels/private/source.mp4`,
    `${origin}/${BUCKET}?uploads=&prefix=channels%2F&max-uploads=1`,
  ])
    await assert.rejects(fetch(url, { method: "GET" }), /OUT_OF_SCOPE/);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 64; i++)
    await fetch(`${origin}/${BUCKET}/${PREFIX}small.bin`, { method: "HEAD" });
  assert.equal(calls.length, 64);
  assert.equal(calls[0][1].redirect, "error");
  await assert.rejects(
    fetch(`${origin}/${BUCKET}/${PREFIX}small.bin`, { method: "HEAD" }),
    /REQUEST_LIMIT/,
  );
});
test("manifest journal records each mutation before provider dispatch", async (t) => {
  const directory = temp(t),
    fake = fakeRuntime();
  for (const [method, field] of [
    ["createMultipartUpload", "create"],
    ["completeMultipartUpload", "complete"],
    ["abortMultipartUpload", "abort"],
    ["deleteObject", "deletion"],
  ]) {
    const original = fake.runtime.storage[method];
    fake.runtime.storage[method] = async (input) => {
      const m = JSON.parse(readFileSync(join(directory, RUN_ID + ".json"), "utf8"));
      const key = typeof input === "string" ? input : input.key;
      assert.equal(m.fixtures.find((f) => f.key === key)[field], "dispatched-unknown");
      return original(input);
    };
  }
  const result = await runAcceptance(approval, { ...fake, directory, dispatchSpacingMs: 0 });
  assert.equal(result.status, "OBSERVATIONS_PASSED");
});

test("new manifest directory fsyncs its validated parent before manifest file and child directory", (t) => {
  const directory = temp(t),
    paths = new Map(),
    syncs = [],
    events = [];
  const io = {
    ...fs,
    openSync(path, ...args) {
      const fd = fs.openSync(path, ...args);
      paths.set(fd, path);
      events.push(["open", path]);
      return fd;
    },
    fsyncSync(fd) {
      syncs.push(paths.get(fd));
      events.push(["sync", paths.get(fd)]);
      fs.fsyncSync(fd);
    },
    closeSync(fd) {
      paths.delete(fd);
      fs.closeSync(fd);
    },
    mkdirSync(path, options) {
      events.push(["mkdir", path]);
      fs.mkdirSync(path, options);
    },
  };
  const journal = createManifest(approval, directory, io);
  assert.deepEqual(syncs, [join(directory, ".."), join(directory, RUN_ID + ".json"), directory]);
  assert.ok(
    events.findIndex(([event]) => event === "mkdir") <
      events.findIndex(([event]) => event === "sync"),
  );
  journal.save();
  assert.equal(syncs.at(-1), directory);
  assert.throws(() => createManifest(approval, directory, io), /ALREADY_RESERVED/);
});
test("failed parent directory fsync refuses before reserving a run or provider I/O", (t) => {
  const directory = temp(t);
  assert.throws(
    () =>
      createManifest(approval, directory, {
        ...fs,
        fsyncSync() {
          throw new Error("simulated durable storage failure");
        },
      }),
    /durable storage failure/,
  );
  assert.equal(existsSync(join(directory, RUN_ID + ".json")), false);
  // A later independently authorized invocation must first sync the existing parent too.
  const syncs = [],
    paths = new Map();
  createManifest(approval, directory, {
    ...fs,
    openSync(path, ...args) {
      const fd = fs.openSync(path, ...args);
      paths.set(fd, path);
      return fd;
    },
    fsyncSync(fd) {
      syncs.push(paths.get(fd));
      fs.fsyncSync(fd);
    },
  });
  assert.equal(syncs[0], join(directory, ".."));
});
test("an unsafe manifest parent is refused without creating a directory", (t) => {
  const directory = temp(t),
    parent = join(directory, "..");
  fs.chmodSync(parent, 0o777);
  assert.throws(() => createManifest(approval, directory), /UNSAFE_MANIFEST_PARENT/);
  assert.equal(existsSync(directory), false);
});
test("delayed browser dispatch cannot place Complete within 1.1 seconds of PUT receipt", async (t) => {
  const fake = fakeRuntime(),
    directory = temp(t);
  let receivedAt = 0,
    completedAt = 0;
  const browser = async (g) => {
    if (g.seq === 2) await new Promise((done) => setTimeout(done, 1200));
    const result = await fake.browser(g);
    if (g.seq === 2) receivedAt = Date.now();
    return result;
  };
  fake.runtime.storage.completeMultipartUpload = async () => {
    completedAt = Date.now();
    throw new Error("intentionally uncertain for offline test");
  };
  const result = await runAcceptance(approval, { ...fake, browser, directory });
  assert.equal(result.fixtures[0].complete, "dispatched-unknown");
  assert.ok(receivedAt > 0 && completedAt - receivedAt >= 1100);
  const manifest = JSON.parse(readFileSync(join(directory, RUN_ID + ".json")));
  assert.ok(manifest.fixtures[0].lastDispatchAt >= receivedAt + 1100);
});

const continuationApproval = {
  ...approval,
  releaseSha: ORIGINAL_RELEASE_SHA,
  executeContinuationApproved: true,
  toolingSha: "b".repeat(40),
};
function predecessorFixture() {
  return {
    schema: 1,
    runId: RUN_ID,
    releaseSha: ORIGINAL_RELEASE_SHA,
    bucket: BUCKET,
    prefix: PREFIX,
    createdAt: "2026-10-09T00:39:52.304Z",
    status: "FAILED",
    code: "STDIO_PROTOCOL_FAILED",
    stage: "abort-and-absence-observed",
    maxRetainedBytes: 10_485_815,
    observationsOnly: true,
    fixtures: FIXTURES.map((fixture, i) => ({
      ...fixture,
      key: PREFIX + fixture.name,
      create: i === 0 ? "acknowledged" : "not-dispatched",
      uploadId: i === 0 ? "original-private-id" : null,
      complete: "not-dispatched",
      deletion: "not-dispatched",
      abort: i === 0 ? "acknowledged" : "not-dispatched",
      debt: false,
      stages: i === 0 ? ["wrong-length-put-dispatched", "abort-and-absence-observed"] : [],
      ...(i === 0 ? { lastDispatchAt: 1791506395871 } : {}),
    })),
  };
}
async function continued(t, config = {}, extras = {}) {
  const directory = temp(t);
  fs.mkdirSync(directory, { mode: 0o700 });
  const predecessor = predecessorFixture();
  const originalBytes = JSON.stringify(predecessor);
  const originalPath = join(directory, RUN_ID + ".json");
  fs.writeFileSync(originalPath, originalBytes, { mode: 0o600 });
  const fake = fakeRuntime(config);
  const clock = {
    time: Date.now(),
    now() {
      return this.time;
    },
    async sleep(ms) {
      this.time += ms;
    },
  };
  const directCalls = [];
  fake.runtime.directNegativeProbe = createDirectNegativeProbe(
    `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    async (url, init) => {
      directCalls.push({ method: init.method, size: init.body.length });
      const journal = JSON.parse(readFileSync(join(directory, CONTINUATION_FILENAME)));
      assert.equal(journal.fixtures[0].create, "acknowledged");
      assert.ok(journal.fixtures[0].stages.includes("wrong-length-put-dispatched"));
      assert.ok(journal.latestGrantExpiresAt > Date.now());
      assert.equal(new URL(url).pathname, `/${BUCKET}/${PREFIX}multipart.bin`);
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["content-length"], "39");
      return new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", {
        status: config.negativeStatus ?? 403,
      });
    },
  );
  if (extras.configure) extras.configure(fake, clock, directory);
  const readPredecessor = () => JSON.parse(originalBytes); // Synthetic offline fixture only; pinned reader tested separately.
  const proof = await runContinuation(continuationApproval, {
    ...fake,
    directory,
    readPredecessor,
    clock,
    dispatchSpacingMs: 0,
    ...extras.dependencies,
  });
  assert.equal(readFileSync(originalPath, "utf8"), originalBytes);
  return {
    ...fake,
    proof,
    directory,
    directCalls,
    clock,
    readPredecessor,
    manifest: JSON.parse(readFileSync(join(directory, CONTINUATION_FILENAME))),
  };
}

test("fixed continuation uses only two remaining CREATEs, one direct negative and three positive browser PUTs", async (t) => {
  const result = await continued(t);
  assert.equal(result.proof.status, "OBSERVATIONS_PASSED");
  assert.equal(result.proof.originalStatus, "FAILED");
  assert.equal(result.proof.singlePartCompletionCovered, false);
  assert.equal(result.proof.postCutoffAbsenceObserved, true);
  assert.equal(result.proof.originalManifestSha256, ORIGINAL_MANIFEST_SHA256);
  assert.deepEqual(result.directCalls, [{ method: "PUT", size: 39 }]);
  assert.deepEqual(
    result.calls.filter((call) => call[0] === "create").map((call) => call[1]),
    [PREFIX + "multipart.bin", PREFIX + "abort.bin"],
  );
  assert.deepEqual(
    result.calls.filter((call) => call[0] === "browser").map((call) => call.slice(1)),
    [
      ["multipart.bin", 1, PART_BYTES],
      ["multipart.bin", 2, 17],
      ["abort.bin", 1, PART_BYTES],
    ],
  );
  assert.equal(result.calls.filter((call) => call[0] === "complete").length, 1);
  assert.equal(result.calls.filter((call) => call[0] === "abort").length, 1);
  assert.equal(result.calls.filter((call) => call[0] === "delete").length, 1);
  assert.ok(result.clock.now() > result.manifest.latestGrantExpiresAt);
  const projected = validateContinuationProof(
    result.proof,
    ORIGINAL_RELEASE_SHA,
    continuationApproval.toolingSha,
    toolingFileHashes(),
  );
  assert.doesNotMatch(JSON.stringify(projected), /private-upload|original-private|https:|binding/);
});

test("continuation permanently reserves its suffix and refuses predecessor debt or previously used remaining scope", async (t) => {
  const result = await continued(t);
  const callCount = result.calls.length;
  await assert.rejects(
    runContinuation(continuationApproval, {
      ...result,
      directory: result.directory,
      readPredecessor: result.readPredecessor,
      clock: result.clock,
      dispatchSpacingMs: 0,
    }),
    /RUN_ID_ALREADY_RESERVED_OR_UNWRITABLE/,
  );
  assert.equal(result.calls.length, callCount);
  for (const mutate of [
    (m) => {
      m.fixtures[0].debt = true;
    },
    (m) => {
      m.fixtures[1].create = "acknowledged";
    },
    (m) => {
      m.fixtures[2].uploadId = "private";
    },
    (m) => {
      m.fixtures[0].lastDispatchAt++;
    },
    (m) => {
      m.fixtures[0].stages.push("foreign");
    },
  ]) {
    const document = predecessorFixture();
    mutate(document);
    assert.throws(() => validatePredecessor(document));
  }
});

test("pinned predecessor reader refuses altered bytes and symlinks before provider work", (t) => {
  const directory = temp(t);
  fs.mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, RUN_ID + ".json");
  fs.writeFileSync(path, JSON.stringify(predecessorFixture()), { mode: 0o600 });
  assert.throws(() => readPredecessorManifest(directory), /PREDECESSOR_DIGEST_MISMATCH/);
  fs.renameSync(path, path + ".actual");
  fs.symlinkSync(path + ".actual", path);
  assert.throws(() => readPredecessorManifest(directory));
  assert.equal(existsSync(join(directory, CONTINUATION_FILENAME)), false);
});

test("unknown continuation CREATE or Complete retains debt and does not allocate, replay or guess cleanup", async (t) => {
  for (const config of [{ unknownCreate: true }, { unknownComplete: true }]) {
    const result = await continued(t, config);
    assert.equal(result.proof.status, "FAILED");
    assert.equal(result.proof.fixtures[0].debt, true);
    assert.equal(result.proof.fixtures[1].create, "not-dispatched");
    assert.equal(result.calls.filter((call) => call[0] === "create").length, 1);
    assert.equal(result.calls.filter((call) => ["abort", "delete"].includes(call[0])).length, 0);
    assert.equal(result.proof.postCutoffAbsenceObserved, false);
    assert.doesNotMatch(JSON.stringify(result.proof), /SECRET|private-upload|credential/);
  }
});

test("predecessor FIFO replacement is refused promptly before any continuation reservation", (t) => {
  const directory = temp(t);
  fs.mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, RUN_ID + ".json");
  const made = spawnSync("mkfifo", ["-m", "600", path], { encoding: "utf8", timeout: 1000 });
  assert.equal(made.status, 0);
  const script = `
    import { readPredecessorManifest } from "./deploy/media/r2-owned-continuation-provider.mjs";
    try { readPredecessorManifest(${JSON.stringify(directory)}); }
    catch (error) { if (error.code === "UNSAFE_PREDECESSOR_FILE") process.exit(0); throw error; }
    process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 1000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(join(directory, CONTINUATION_FILENAME)), false);
});

test("failed direct negative stops before positive PUTs and cannot turn later absence into success", async (t) => {
  const result = await continued(t, { negativeStatus: 200 });
  assert.equal(result.proof.status, "FAILED");
  assert.equal(result.proof.code, "DIRECT_EXACT_LENGTH_REJECTION_NOT_PROVEN");
  assert.equal(result.calls.filter((call) => call[0] === "browser").length, 0);
  assert.equal(result.calls.filter((call) => call[0] === "create").length, 1);
  assert.equal(result.calls.filter((call) => call[0] === "abort").length, 1);
  assert.equal(result.proof.fixtures[1].create, "not-dispatched");
});

test("post-grant cutoff failure remains debt and cannot publish continuation PASS", async (t) => {
  const result = await continued(
    t,
    {},
    {
      configure(fake, clock) {
        const sleep = clock.sleep.bind(clock);
        clock.sleep = async (ms) => {
          await sleep(ms);
          fake.runtime.storage.headObject = async () => {
            throw new Error("SECRET_PROVIDER_ERROR");
          };
        };
      },
    },
  );
  assert.equal(result.proof.status, "FAILED");
  assert.equal(result.proof.postCutoffAbsenceObserved, false);
  assert.ok(result.proof.fixtures.every((record) => record.debt));
  assert.doesNotMatch(JSON.stringify(result.proof), /SECRET/);
});

test("direct negative transport cannot send arbitrary sizes, keys, IDs, queries or replay", async () => {
  const origin = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
  const record = {
    name: "multipart.bin",
    key: PREFIX + "multipart.bin",
    uploadId: "known-private-id",
    create: "acknowledged",
  };
  const signed = signedGrant({
    key: record.key,
    uploadId: record.uploadId,
    partNumber: 1,
    expectedSizeBytes: 38,
  });
  const grant = {
    type: "grant",
    seq: 0,
    fixture: record.name,
    partNumber: 1,
    expectedSizeBytes: 38,
    payloadSizeBytes: 39,
    offset: 0,
    url: signed.url,
    expiresAt: signed.expiresAt.toISOString(),
  };
  let sends = 0;
  const fetch = async () => {
    sends++;
    return new Response("<Code>SignatureDoesNotMatch</Code>", { status: 403 });
  };
  for (const mutate of [
    (g) => {
      g.payloadSizeBytes = 40;
    },
    (g) => {
      g.fixture = "small.bin";
    },
    (g) => {
      g.url = g.url.replace("known-private-id", "unknown-private-id");
    },
    (g) => {
      g.url += "&extra=SECRET";
    },
    (g) => {
      g.expectedSizeBytes = 39;
    },
    (g) => {
      g.partNumber = 2;
    },
  ]) {
    const candidate = { ...grant };
    mutate(candidate);
    await assert.rejects(createDirectNegativeProbe(origin, fetch)(record, candidate));
  }
  assert.equal(sends, 0);
  const probe = createDirectNegativeProbe(origin, fetch);
  await probe(record, grant);
  await assert.rejects(probe(record, grant), /DIRECT_NEGATIVE_SCOPE_REQUIRED/);
  assert.equal(sends, 1);
});

test("continuation CLI refuses before source staging or provider work without separate exact approval", () => {
  const result = spawnSync(process.execPath, ["deploy/media/r2-owned-continuation-provider.mjs"], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /EXPLICIT_CONTINUATION_APPROVAL_REQUIRED/);
  assert.equal(result.stderr, "");
});
