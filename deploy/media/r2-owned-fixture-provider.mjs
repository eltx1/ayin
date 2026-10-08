#!/usr/bin/env node
// This isolated, manually authorized proof never imports the application or its database.
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const RUN_ID = "34c4947c-ba13-4fc9-9087-0d1db8cc4d28";
export const PREFIX = `ayin-recovery-acceptance/${RUN_ID}/`;
export const BUCKET = "ayin-production-media";
export const CLEANUP_ACK = "DELETE_ONLY_CREATED_FIXTURES";
export const PART_BYTES = 5 * 1024 * 1024;
export const MAX_RETAINED_BYTES = 10_485_815;
export const MANIFEST_DIRECTORY = "/home/ayin/.r2-acceptance-manifests";
export const FIXTURES = Object.freeze([
  Object.freeze({ name: "small.bin", size: 38 }),
  Object.freeze({ name: "multipart.bin", size: PART_BYTES + 17 }),
  Object.freeze({ name: "abort.bin", size: PART_BYTES }),
]);
export const REQUEST_MS = 30_000;
export const LINE_BYTES = 16_384;

export class ProofFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function checked(condition, code) {
  if (!condition) throw new ProofFailure(code);
}
export function safeCode(error) {
  return error instanceof ProofFailure && /^[A-Z_]{1,80}$/.test(error.code)
    ? error.code
    : "PROVIDER_OR_PROTOCOL_FAILURE";
}
export function validateApproval(options) {
  checked(options?.executeApproved === true, "EXPLICIT_APPROVAL_REQUIRED");
  checked(options.runId === RUN_ID && options.prefix === PREFIX, "FIXED_SCOPE_REQUIRED");
  checked(options.cleanupAck === CLEANUP_ACK, "EXACT_CLEANUP_APPROVAL_REQUIRED");
  checked(/^[0-9a-f]{40}$/.test(options.releaseSha ?? ""), "EXACT_RELEASE_REQUIRED");
  return options;
}
export function parseArguments(args) {
  const options = {};
  const names = new Map([
    ["--run-id", "runId"],
    ["--confirm-prefix", "prefix"],
    ["--ack-cleanup", "cleanupAck"],
    ["--release-sha", "releaseSha"],
  ]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute-approved") {
      checked(options.executeApproved === undefined, "INVALID_ARGUMENTS");
      options.executeApproved = true;
    } else {
      const name = names.get(args[i]);
      checked(
        name && options[name] === undefined && typeof args[i + 1] === "string",
        "INVALID_ARGUMENTS",
      );
      options[name] = args[++i];
    }
  }
  return validateApproval(options);
}
export function fixtureBytes(size, offset = 0) {
  checked(
    Number.isSafeInteger(size) &&
      size > 0 &&
      size <= PART_BYTES + 17 &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      offset <= PART_BYTES,
    "INVALID_FIXTURE_BYTES",
  );
  const bytes = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) bytes[i] = ((offset + i) * 31 + 17) & 255;
  return bytes;
}
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function identityRoot(bytes) {
  const chunk = 4 * 1024 * 1024;
  const header = Buffer.alloc(16);
  header.writeBigUInt64BE(BigInt(bytes.length));
  header.writeUInt32BE(chunk, 8);
  header.writeUInt32BE(Math.ceil(bytes.length / chunk), 12);
  const hash = createHash("sha256").update("AYIN:source-file:sha256-chunks:v1\0").update(header);
  for (let offset = 0; offset < bytes.length; offset += chunk)
    hash.update(
      createHash("sha256")
        .update(bytes.subarray(offset, offset + chunk))
        .digest(),
    );
  return hash.digest("hex");
}
export async function bounded(work, timeoutMs = REQUEST_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProofFailure("BOUNDED_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
export async function readBodyBounded(response, limit, signal) {
  checked(response.body, "RESPONSE_BODY_REQUIRED");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      checked(size <= limit, "RESPONSE_BYTE_LIMIT");
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

// Initial O_EXCL reservation survives crashes and is never removed, even on success.
// Every dispatch is fsynced before provider I/O; updates use durable atomic rename.
const manifestIo = {
  constants,
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
};
export function createManifest(options, directory = MANIFEST_DIRECTORY, io = manifestIo) {
  const {
    constants,
    closeSync,
    existsSync,
    fsyncSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    realpathSync,
    renameSync,
    writeFileSync,
  } = io;
  validateApproval(options);
  const parentPath = dirname(resolve(directory));
  const parentStat = lstatSync(parentPath);
  checked(
    parentStat.isDirectory() &&
      !parentStat.isSymbolicLink() &&
      parentStat.uid === process.getuid() &&
      (parentStat.mode & 0o022) === 0 &&
      realpathSync(parentPath) === parentPath,
    "UNSAFE_MANIFEST_PARENT",
  );
  const parentFd = openSync(
    parentPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(parentFd);
    checked(
      opened.isDirectory() && opened.dev === parentStat.dev && opened.ino === parentStat.ino,
      "UNSAFE_MANIFEST_PARENT",
    );
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
    // Persist the new directory's entry in /home/ayin before reserving a run.
    // Sync even when it exists, repairing an earlier interrupted initialization.
    fsyncSync(parentFd);
  } finally {
    closeSync(parentFd);
  }
  const stat = lstatSync(directory);
  checked(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(),
    "UNSAFE_MANIFEST_DIRECTORY",
  );
  checked(realpathSync(directory) === resolve(directory), "UNSAFE_MANIFEST_DIRECTORY");
  const path = resolve(directory, `${RUN_ID}.json`);
  const document = {
    schema: 1,
    runId: RUN_ID,
    releaseSha: options.releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    createdAt: new Date().toISOString(),
    status: "RESERVED",
    stage: "reserved",
    code: null,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    observationsOnly: true,
    fixtures: FIXTURES.map((fixture) => ({
      ...fixture,
      key: PREFIX + fixture.name,
      create: "not-dispatched",
      uploadId: null,
      complete: "not-dispatched",
      abort: "not-dispatched",
      deletion: "not-dispatched",
      debt: false,
      stages: [],
    })),
  };
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new ProofFailure("RUN_ID_ALREADY_RESERVED_OR_UNWRITABLE");
  }
  try {
    writeFileSync(fd, JSON.stringify(document));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const syncDirectory = () => {
    const parent = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  };
  syncDirectory();
  return {
    document,
    save() {
      const temp = `${path}.${randomUUID()}.tmp`;
      const handle = openSync(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(handle, JSON.stringify(document));
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(temp, path);
      syncDirectory();
    },
  };
}
export function publicProof(manifest) {
  return {
    schema: 1,
    type: "proof",
    runId: RUN_ID,
    releaseSha: manifest.releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    status: manifest.status,
    stage: manifest.stage,
    code: manifest.code,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    observationsOnly: true,
    activationEnabled: false,
    fixtures: manifest.fixtures.map((f) => ({
      name: f.name,
      key: f.key,
      size: f.size,
      create: f.create,
      allocationKnown: Boolean(f.uploadId),
      complete: f.complete,
      abort: f.abort,
      deletion: f.deletion,
      debt: f.debt,
      stages: [...f.stages],
    })),
  };
}
function isMissingObject(error) {
  return error?.method === "HEAD" && error?.status === 404;
}
function isMissingUpload(error) {
  return (
    (error?.code === "NO_SUCH_UPLOAD" &&
      error?.operation === "listParts" &&
      error?.providerStatus === 404) ||
    (error?.status === 404 && error?.method === "GET" && error?.providerCode === "NoSuchUpload")
  );
}
async function assertAbsent(runtime, key) {
  try {
    await runtime.storage.headObject(key);
  } catch (error) {
    if (isMissingObject(error)) return;
    throw error;
  }
  throw new ProofFailure("PREEXISTING_OR_RESIDUAL_OBJECT");
}
async function assertNoParts(runtime, record) {
  try {
    await runtime.storage.listParts({ key: record.key, uploadId: record.uploadId });
  } catch (error) {
    if (isMissingUpload(error)) return;
    throw error;
  }
  throw new ProofFailure("MULTIPART_STILL_OBSERVED");
}
export async function verifySignatureCapability(storage) {
  checked(
    typeof storage.observeUploadCompletion === "function",
    "DEPLOYED_ADAPTER_CAPABILITY_MISSING",
  );
  const input = {
    key: PREFIX + "small.bin",
    uploadId: "capability-check-no-provider-io",
    partNumber: 1,
    expiresInSeconds: 90,
    now: new Date("2026-10-08T00:00:00.000Z"),
  };
  const first = await storage.authorizeMultipartPart({ ...input, expectedSizeBytes: 38 });
  const second = await storage.authorizeMultipartPart({ ...input, expectedSizeBytes: 37 });
  const a = new URL(first.url),
    b = new URL(second.url);
  checked(
    a.searchParams.get("X-Amz-SignedHeaders") === "content-length;host" &&
      b.searchParams.get("X-Amz-SignedHeaders") === "content-length;host" &&
      a.searchParams.get("X-Amz-Signature") !== b.searchParams.get("X-Amz-Signature"),
    "DEPLOYED_EXACT_LENGTH_SIGNING_MISSING",
  );
  let rejected = false;
  try {
    await storage.authorizeMultipartPart({ ...input, expectedSizeBytes: 0 });
  } catch {
    rejected = true;
  }
  checked(rejected, "DEPLOYED_EXACT_LENGTH_VALIDATION_MISSING");
}

export async function runAcceptance(
  options,
  {
    runtime,
    browser,
    directory = MANIFEST_DIRECTORY,
    timeoutMs = REQUEST_MS,
    dispatchSpacingMs = 1100,
  },
) {
  validateApproval(options);
  const journal = createManifest(options, directory);
  const m = journal.document;
  let sequence = 0;
  const call = (work) => bounded(work, timeoutMs);
  const beforeMutation = async (record) => {
    const notBefore = (record.lastDispatchAt ?? 0) + dispatchSpacingMs;
    while (Date.now() < notBefore)
      await new Promise((done) => setTimeout(done, notBefore - Date.now()));
    record.lastDispatchAt = Date.now();
  };
  const stage = (record, name) => {
    m.stage = name;
    if (record) record.stages.push(name);
    journal.save();
  };
  const put = async (record, partNumber, size, offset, wrongLength = false) => {
    const signed = await runtime.storage.authorizeMultipartPart({
      key: record.key,
      uploadId: record.uploadId,
      partNumber,
      expectedSizeBytes: size,
      expiresInSeconds: 90,
    });
    checked(
      new URL(signed.url).searchParams.get("X-Amz-SignedHeaders") === "content-length;host",
      "EXACT_LENGTH_GRANT_REQUIRED",
    );
    await beforeMutation(record);
    sequence++;
    stage(
      record,
      wrongLength ? "wrong-length-put-dispatched" : `part-${partNumber}-put-dispatched`,
    );
    let reply;
    try {
      reply = await bounded(
        () =>
          browser({
            type: "grant",
            seq: sequence,
            fixture: record.name,
            partNumber,
            expectedSizeBytes: size,
            payloadSizeBytes: wrongLength ? size + 1 : size,
            offset,
            url: signed.url,
            expiresAt: signed.expiresAt.toISOString(),
          }),
        Math.min(90_000, timeoutMs * 3),
      );
    } finally {
      // Navigation/CORS can delay actual dispatch beyond grant issuance. Anchor
      // the next per-key mutation conservatively after browser result/timeout.
      record.lastDispatchAt = Date.now();
      journal.save();
    }
    checked(reply?.type === "put-result" && reply.seq === sequence, "INVALID_BROWSER_REPLY");
    if (wrongLength)
      checked(
        reply.outcome === "http" &&
          reply.status === 403 &&
          reply.errorCode === "SignatureDoesNotMatch",
        "EXACT_LENGTH_REJECTION_NOT_PROVEN",
      );
    else checked(reply.outcome === "http" && reply.status === 200, "BROWSER_PUT_NOT_ACCEPTED");
  };
  const parts = async (record, sizes) => {
    const found = await call(() =>
      runtime.storage.listParts({ key: record.key, uploadId: record.uploadId }),
    );
    checked(
      found.length === sizes.length &&
        found.every(
          (part, i) =>
            part.partNumber === i + 1 &&
            part.sizeBytes === sizes[i] &&
            typeof part.etag === "string" &&
            part.etag.length > 0 &&
            part.etag.length <= 256,
        ),
      "AUTHORITATIVE_PARTS_MISMATCH",
    );
    return found.map(({ partNumber, etag }) => ({ partNumber, etag }));
  };
  const abort = async (record) => {
    await beforeMutation(record);
    record.abort = "dispatched-unknown";
    record.debt = true;
    journal.save();
    await call(() =>
      runtime.storage.abortMultipartUpload({ key: record.key, uploadId: record.uploadId }),
    );
    record.abort = "acknowledged";
    journal.save();
    await call(() => assertNoParts(runtime, record));
    await call(() => assertAbsent(runtime, record.key));
    record.debt = false;
    stage(record, "abort-and-absence-observed");
  };
  try {
    await verifySignatureCapability(runtime.storage);
    stage(null, "signature-capability-verified");
    // All three collision checks finish before the first creating dispatch.
    for (const record of m.fixtures) {
      await call(() => assertAbsent(runtime, record.key));
      await call(() => runtime.assertNoExistingAllocation(record.key));
    }
    stage(null, "all-exact-keys-clear");
    for (const record of m.fixtures) {
      const source = fixtureBytes(record.size);
      const root = identityRoot(source);
      checked((await runtime.identity(source)) === root, "DEPLOYED_IDENTITY_ALGORITHM_MISMATCH");
      record.binding = {
        sessionId: RUN_ID,
        sourceAssetId: randomUUID(),
        contentIdentityDigest: root,
      };
      record.sha256 = sha256(source);
      await beforeMutation(record);
      record.create = "dispatched-unknown";
      record.debt = true;
      journal.save();
      const allocation = await call(() =>
        runtime.storage.createMultipartUpload({
          key: record.key,
          contentType: "application/octet-stream",
          uploadBinding: record.binding,
        }),
      );
      checked(
        typeof allocation.uploadId === "string" &&
          /^[\x21-\x7e]{1,1024}$/.test(allocation.uploadId),
        "CREATE_ID_INVALID_OR_UNKNOWN",
      );
      record.uploadId = allocation.uploadId;
      record.create = "acknowledged";
      journal.save();
      if (record.name === "small.bin") {
        await put(record, 1, 38, 0, true);
        await parts(record, []);
        stage(record, "wrong-length-provider-rejected-with-no-part");
        await put(record, 1, 38, 0);
      } else {
        await put(record, 1, PART_BYTES, 0);
        await parts(record, [PART_BYTES]);
        if (record.name === "abort.bin") {
          await abort(record);
          continue;
        }
        // Fresh authorization after authoritative inventory, without replaying part 1.
        stage(record, "resume-authoritative-part-one-observed");
        await put(record, 2, 17, PART_BYTES);
      }
      const completedParts = await parts(
        record,
        record.name === "small.bin" ? [38] : [PART_BYTES, 17],
      );
      await beforeMutation(record);
      record.complete = "dispatched-unknown";
      journal.save();
      await call(() =>
        runtime.storage.completeMultipartUpload({
          key: record.key,
          uploadId: record.uploadId,
          parts: completedParts,
        }),
      );
      // Deliberately discard the returned completion receipt/ETag once. This
      // simulates application receipt loss, not a genuinely unknown transport result.
      record.complete =
        record.name === "multipart.bin" ? "acknowledged-receipt-discarded" : "acknowledged";
      journal.save();
      const expected = {
        sizeBytes: record.size,
        contentType: "application/octet-stream",
        binding: record.binding,
      };
      const observation = await call(() =>
        runtime.storage.observeUploadCompletion({
          key: record.key,
          uploadId: record.uploadId,
          expected,
        }),
      );
      checked(observation.status === "OBJECT_VERIFIED", "COMPLETION_OBSERVATION_MISMATCH");
      const actual = await call((signal) => runtime.getExact(record.key, expected, signal));
      checked(
        actual.length === record.size &&
          sha256(actual) === record.sha256 &&
          identityRoot(actual) === root &&
          (await runtime.identity(actual)) === root,
        "DIRECT_READBACK_IDENTITY_MISMATCH",
      );
      stage(record, "direct-get-sha256-and-ayin-root-verified");
    }
    m.status = "OBSERVATIONS_PASSED";
  } catch (error) {
    m.status = "FAILED";
    m.code = safeCode(error);
  } finally {
    for (const record of m.fixtures) {
      // Never guess an allocation ID, replay creating calls, or turn an unknown
      // Complete into absence. Unknown state remains durable debt for review.
      if (!record.uploadId || record.create !== "acknowledged") continue;
      try {
        if (record.complete === "not-dispatched" && record.abort === "not-dispatched")
          await abort(record);
        else if (
          record.complete.startsWith("acknowledged") &&
          record.deletion === "not-dispatched"
        ) {
          // Re-verify ownership immediately before deleting only the created key.
          const observation = await call(() =>
            runtime.storage.observeUploadCompletion({
              key: record.key,
              uploadId: record.uploadId,
              expected: {
                sizeBytes: record.size,
                contentType: "application/octet-stream",
                binding: record.binding,
              },
            }),
          );
          checked(observation.status === "OBJECT_VERIFIED", "CLEANUP_OWNERSHIP_NOT_VERIFIED");
          await beforeMutation(record);
          record.deletion = "dispatched-unknown";
          record.debt = true;
          journal.save();
          await call(() => runtime.storage.deleteObject(record.key));
          record.deletion = "acknowledged";
          journal.save();
          await call(() => assertAbsent(runtime, record.key));
          record.debt = false;
          stage(record, "owned-object-deletion-and-absence-observed");
        }
      } catch (error) {
        record.debt = true;
        m.status = "FAILED";
        m.code ??= safeCode(error);
      }
    }
    if (m.fixtures.some((record) => record.debt)) {
      m.status = "FAILED";
      m.code ??= "RETAINED_UNCERTAINTY_DEBT";
    }
    journal.save();
  }
  return publicProof(m);
}

export function makeJsonlChannel(input, output) {
  let buffer = Buffer.alloc(0),
    pending,
    stopped = false;
  const fail = () => {
    stopped = true;
    if (pending) {
      pending.reject(new ProofFailure("STDIO_PROTOCOL_FAILED"));
      pending = undefined;
    }
  };
  input.on("error", fail);
  input.on("end", fail);
  output.on("error", fail);
  input.on("data", (chunk) => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > LINE_BYTES || !pending) {
      fail();
      return;
    }
    const end = buffer.indexOf(10);
    if (end < 0) return;
    if (end !== buffer.length - 1) {
      fail();
      return;
    }
    try {
      const reply = JSON.parse(buffer.subarray(0, end).toString("utf8"));
      checked(
        Object.keys(reply).sort().join(",") === "errorCode,outcome,seq,status,type",
        "INVALID_BROWSER_REPLY",
      );
      const waiter = pending;
      pending = undefined;
      buffer = Buffer.alloc(0);
      waiter.resolve(reply);
    } catch {
      fail();
    }
  });
  return async (grant) => {
    checked(!stopped && !pending, "STDIO_PROTOCOL_FAILED");
    const line = JSON.stringify(grant) + "\n";
    checked(Buffer.byteLength(line) <= LINE_BYTES, "STDIO_LINE_LIMIT");
    return bounded(
      () =>
        new Promise((resolveReply, reject) => {
          pending = { resolve: resolveReply, reject };
          output.write(line, (error) => {
            if (error) fail();
          });
        }),
      90_000,
    ).finally(() => {
      pending = undefined;
    });
  };
}

export function createBoundedProviderFetch(origin, originalFetch) {
  const endpoint = new URL(origin);
  checked(
    /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(origin),
    "INVALID_PROVIDER_ORIGIN",
  );
  let requests = 0,
    responseBytes = 0;
  return async (url, init) => {
    const target = new URL(url);
    const keys = FIXTURES.map((f) => `/${BUCKET}/${PREFIX}${f.name}`);
    const collision =
      init.method === "GET" &&
      target.pathname === `/${BUCKET}` &&
      target.searchParams.get("uploads") === "" &&
      target.searchParams.get("max-uploads") === "1" &&
      FIXTURES.some((f) => target.searchParams.get("prefix") === PREFIX + f.name);
    checked(
      target.origin === endpoint.origin &&
        !target.username &&
        !target.password &&
        !target.hash &&
        (keys.includes(target.pathname) || collision),
      "PROVIDER_TARGET_OUT_OF_SCOPE",
    );
    checked(
      ["GET", "HEAD", "POST", "DELETE"].includes(init.method) && ++requests <= 64,
      "PROVIDER_REQUEST_LIMIT",
    );
    return bounded(async (signal) => {
      const response = await originalFetch(url, {
        ...init,
        redirect: "error",
        signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
      });
      const maxBytes = init.method === "GET" && !target.search ? PART_BYTES + 17 : 65_536;
      const bytes = response.body ? await readBodyBounded(response, maxBytes, signal) : null;
      responseBytes += bytes?.length ?? 0;
      checked(responseBytes <= 16 * 1024 * 1024, "PROVIDER_TOTAL_RESPONSE_LIMIT");
      return new Response(bytes, { status: response.status, headers: response.headers });
    });
  };
}

async function productionRuntime(options) {
  checked(
    process.env.APP_ENV === "production" &&
      process.env.NODE_ENV === "production" &&
      process.env.HOME === "/home/ayin" &&
      process.getuid() !== 0,
    "ISOLATED_PRODUCTION_ENV_REQUIRED",
  );
  checked(
    process.env.R2_BUCKET === BUCKET && /^[a-f0-9]{32}$/.test(process.env.R2_ACCOUNT_ID ?? ""),
    "FIXED_PRODUCTION_BUCKET_REQUIRED",
  );
  checked(process.env.AYIN_UPLOAD_RECOVERY_V2_ENABLED !== "1", "DEFAULT_OFF_RELEASE_REQUIRED");
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  checked(
    root.startsWith("/home/ayin/htdocs/releases/") &&
      realpathSync("/home/ayin/htdocs/current") === root &&
      realpathSync(process.cwd()) === root,
    "ALREADY_DEPLOYED_RELEASE_REQUIRED",
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 256,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  checked(head === options.releaseSha, "DEPLOYED_RELEASE_SHA_MISMATCH");
  checked(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 16_384,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() === "",
    "DIRTY_DEPLOYED_RELEASE",
  );
  const [
    { loadMediaStorageConfig },
    { R2MediaStorageAdapter },
    { R2SigV4 },
    xml,
    metadata,
    identity,
  ] = await Promise.all([
    import("../../apps/api/dist/media/media-storage.config.js"),
    import("../../apps/api/dist/media/r2-media-storage.adapter.js"),
    import("../../apps/api/dist/media/r2-sigv4.js"),
    import("../../apps/api/dist/media/r2-xml.js"),
    import("../../apps/api/dist/media/r2-upload-completion.js"),
    import("../../packages/types/dist/upload-file-identity.js"),
  ]);
  const config = loadMediaStorageConfig(process.env);
  checked(
    config.mode === "r2" && config.bucket === BUCKET && !config.recoveryV2Enabled,
    "PRODUCTION_CONFIG_MISMATCH",
  );
  const storage = new R2MediaStorageAdapter(config),
    signer = new R2SigV4(config);
  const endpoint = new URL(config.endpoint);
  globalThis.fetch = createBoundedProviderFetch(endpoint.origin, globalThis.fetch);
  return {
    storage,
    r2Origin: endpoint.origin,
    identity: async (bytes) =>
      (
        await identity.hashUploadFileIdentity(
          (async function* () {
            yield bytes;
          })(),
          bytes.length,
        )
      ).rootSha256,
    assertNoExistingAllocation: async (key) => {
      const response = await signer.request({
        method: "GET",
        query: [
          ["uploads", ""],
          ["prefix", key],
          ["max-uploads", "1"],
        ],
        signal: AbortSignal.timeout(REQUEST_MS),
      });
      checked(response.status === 200, "COLLISION_CHECK_STATUS_INVALID");
      const root = xml.parseR2Xml(await xml.readR2XmlText(response, 16_384));
      checked(
        root.name === "ListMultipartUploadsResult" &&
          xml.xmlField(root, "Bucket") === BUCKET &&
          xml.xmlField(root, "Prefix") === key &&
          xml.xmlField(root, "IsTruncated") === "false" &&
          !root.children.some(
            (child) => child.name === "Upload" || child.name === "CommonPrefixes",
          ),
        "PREEXISTING_OR_UNCERTAIN_ALLOCATION",
      );
    },
    getExact: async (key, expected, signal) => {
      const response = await signer.request({ method: "GET", key, signal });
      checked(
        response.status === 200 && !response.headers.has("content-range"),
        "DIRECT_GET_STATUS_INVALID",
      );
      checked(
        metadata.matchUploadCompletionObject(
          metadata.objectMetadataFromHeaders(response.headers),
          expected,
        ).status === "OBJECT_VERIFIED",
        "DIRECT_GET_BINDING_MISMATCH",
      );
      const bytes = await readBodyBounded(response, expected.sizeBytes, signal);
      checked(bytes.length === expected.sizeBytes, "DIRECT_GET_LENGTH_MISMATCH");
      return bytes;
    },
  };
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runtime = await productionRuntime(options);
  process.stdout.write(
    JSON.stringify({ type: "ready", r2Origin: runtime.r2Origin, releaseSha: options.releaseSha }) +
      "\n",
  );
  const proof = await runAcceptance(options, {
    runtime,
    browser: makeJsonlChannel(process.stdin, process.stdout),
  });
  process.stdout.write(JSON.stringify(proof) + "\n");
  process.exitCode = proof.status === "OBSERVATIONS_PASSED" ? 0 : 1;
  process.stdin.pause();
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stdout.write(JSON.stringify({ type: "failure", code: safeCode(error) }) + "\n");
    process.exitCode = 1;
    process.stdin.pause();
  });
}
