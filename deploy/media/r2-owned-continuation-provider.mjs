#!/usr/bin/env node
// One fixed continuation of the retained failed run. Never resets its predecessor.
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RUN_ID,
  PREFIX,
  BUCKET,
  FIXTURES,
  MAX_RETAINED_BYTES,
  MANIFEST_DIRECTORY,
  checked,
  safeCode,
  parseArguments,
  validateApproval,
  sha256,
  fixtureBytes,
  bounded,
  readBodyBounded,
  reserveManifest,
  publicProof,
  runReservedAcceptance,
  assertAbsent,
  assertNoParts,
  productionRuntime,
  makeJsonlChannel,
  CONTINUATION_ID,
  ORIGINAL_RELEASE_SHA,
  ORIGINAL_MANIFEST_SHA256,
} from "./r2-owned-fixture-provider.mjs";

export { CONTINUATION_ID, ORIGINAL_RELEASE_SHA, ORIGINAL_MANIFEST_SHA256 };
export const CONTINUATION_FILENAME = `${RUN_ID}.${CONTINUATION_ID}.json`;

export function validateContinuationApproval(options) {
  validateApproval(options);
  checked(options.executeContinuationApproved === true, "EXPLICIT_CONTINUATION_APPROVAL_REQUIRED");
  checked(
    options.releaseSha === ORIGINAL_RELEASE_SHA && /^[a-f0-9]{40}$/.test(options.toolingSha ?? ""),
    "EXACT_CONTINUATION_RELEASE_AND_TOOLING_REQUIRED",
  );
  return options;
}
export function parseContinuationArguments(args) {
  checked(
    args.filter((arg) => arg === "--execute-continuation-approved").length === 1,
    "EXPLICIT_CONTINUATION_APPROVAL_REQUIRED",
  );
  const rest = args.filter((arg) => arg !== "--execute-continuation-approved");
  checked(rest.filter((arg) => arg === "--tooling-sha").length === 1, "EXACT_TOOLING_REQUIRED");
  const index = rest.indexOf("--tooling-sha");
  const toolingSha = rest[index + 1];
  rest.splice(index, 2);
  return validateContinuationApproval({
    ...parseArguments(rest),
    toolingSha,
    executeContinuationApproved: true,
  });
}

export function toolingFileHashes(directory = dirname(fileURLToPath(import.meta.url))) {
  return {
    providerSha256: sha256(readFileSync(resolve(directory, "r2-owned-fixture-provider.mjs"))),
    continuationSha256: sha256(
      readFileSync(resolve(directory, "r2-owned-continuation-provider.mjs")),
    ),
  };
}
function validateStagedTooling(options) {
  const directory = dirname(fileURLToPath(import.meta.url));
  checked(
    directory === `/home/ayin/.r2-acceptance-tooling/${options.toolingSha}` &&
      realpathSync(directory) === directory,
    "FIXED_TOOLING_DIRECTORY_REQUIRED",
  );
  for (const path of [dirname(directory), directory]) {
    const stat = lstatSync(path);
    checked(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o077) === 0,
      "UNSAFE_TOOLING_DIRECTORY",
    );
  }
  for (const name of [
    "r2-owned-fixture-provider.mjs",
    "r2-owned-continuation-provider.mjs",
    "tooling-manifest.json",
  ]) {
    const stat = lstatSync(resolve(directory, name));
    checked(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid() &&
        stat.nlink === 1 &&
        (stat.mode & 0o077) === 0 &&
        stat.size <= 131_072,
      "UNSAFE_TOOLING_FILE",
    );
  }
  const expected = JSON.parse(readFileSync(resolve(directory, "tooling-manifest.json"), "utf8"));
  const actual = toolingFileHashes(directory);
  checked(
    expected.toolingSha === options.toolingSha &&
      expected.providerSha256 === actual.providerSha256 &&
      expected.continuationSha256 === actual.continuationSha256,
    "STAGED_TOOLING_HASH_MISMATCH",
  );
  return actual;
}
export function validatePredecessor(document) {
  checked(
    document?.schema === 1 &&
      document.runId === RUN_ID &&
      document.prefix === PREFIX &&
      document.bucket === BUCKET &&
      document.releaseSha === ORIGINAL_RELEASE_SHA &&
      document.status === "FAILED" &&
      document.code === "STDIO_PROTOCOL_FAILED" &&
      document.stage === "abort-and-absence-observed" &&
      document.observationsOnly === true &&
      document.maxRetainedBytes === MAX_RETAINED_BYTES &&
      Array.isArray(document.fixtures) &&
      document.fixtures.length === 3,
    "PREDECESSOR_STATE_MISMATCH",
  );
  document.fixtures.forEach((record, i) => {
    checked(
      record.name === FIXTURES[i].name &&
        record.key === PREFIX + record.name &&
        record.size === FIXTURES[i].size &&
        record.complete === "not-dispatched" &&
        record.deletion === "not-dispatched" &&
        record.debt === false &&
        Array.isArray(record.stages),
      "PREDECESSOR_FIXTURE_MISMATCH",
    );
    if (i === 0) {
      checked(
        record.create === "acknowledged" &&
          record.abort === "acknowledged" &&
          typeof record.uploadId === "string" &&
          /^[\x21-\x7e]{1,1024}$/.test(record.uploadId) &&
          record.stages.join(",") === "wrong-length-put-dispatched,abort-and-absence-observed" &&
          record.lastDispatchAt === 1791506395871,
        "PREDECESSOR_ABORT_NOT_SETTLED",
      );
    } else {
      checked(
        record.create === "not-dispatched" &&
          record.abort === "not-dispatched" &&
          record.uploadId === null &&
          record.stages.length === 0 &&
          record.lastDispatchAt == null,
        "PREDECESSOR_REMAINING_SCOPE_USED",
      );
    }
  });
  checked(document.createdAt === "2026-10-09T00:39:52.304Z", "PREDECESSOR_TIME_MISMATCH");
  return document;
}

export function readPredecessorManifest(directory = MANIFEST_DIRECTORY) {
  checked(/^[a-f0-9]{64}$/.test(ORIGINAL_MANIFEST_SHA256), "PREDECESSOR_DIGEST_NOT_PINNED");
  for (const [path, permissions] of [
    [dirname(resolve(directory)), 0o022],
    [resolve(directory), 0o077],
  ]) {
    const stat = lstatSync(path);
    checked(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid() &&
        (stat.mode & permissions) === 0 &&
        realpathSync(path) === path,
      "UNSAFE_PREDECESSOR_DIRECTORY",
    );
  }
  const path = resolve(directory, RUN_ID + ".json");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    checked(
      stat.isFile() &&
        stat.uid === process.getuid() &&
        stat.nlink === 1 &&
        (stat.mode & 0o777) === 0o600 &&
        stat.size > 0 &&
        stat.size <= 16_384,
      "UNSAFE_PREDECESSOR_FILE",
    );
    const buffer = Buffer.alloc(16_385);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    checked(
      count === stat.size && count <= 16_384 && fstatSync(fd).size === stat.size,
      "PREDECESSOR_READ_CHANGED",
    );
    const bytes = buffer.subarray(0, count);
    checked(sha256(bytes) === ORIGINAL_MANIFEST_SHA256, "PREDECESSOR_DIGEST_MISMATCH");
    return validatePredecessor(JSON.parse(bytes.toString("utf8")));
  } finally {
    closeSync(fd);
  }
}

// The unwrapped transport is captured before productionRuntime installs its
// control-only fetch. This separate path cannot send an arbitrary provider PUT.
export function createDirectNegativeProbe(origin, originalFetch) {
  checked(
    /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(origin),
    "INVALID_PROVIDER_ORIGIN",
  );
  let used = false;
  return async (record, grant) => {
    checked(
      !used &&
        record.name === "multipart.bin" &&
        record.key === PREFIX + "multipart.bin" &&
        record.create === "acknowledged" &&
        typeof record.uploadId === "string" &&
        /^[\x21-\x7e]{1,1024}$/.test(record.uploadId) &&
        grant.fixture === record.name &&
        grant.type === "grant" &&
        grant.seq === 0 &&
        grant.partNumber === 1 &&
        grant.expectedSizeBytes === 38 &&
        grant.payloadSizeBytes === 39 &&
        grant.offset === 0,
      "DIRECT_NEGATIVE_SCOPE_REQUIRED",
    );
    checked(
      typeof grant.url === "string" && grant.url.length <= 8192,
      "DIRECT_NEGATIVE_URL_INVALID",
    );
    const url = new URL(grant.url);
    checked(
      url.origin === origin &&
        url.pathname === `/${BUCKET}/${PREFIX}multipart.bin` &&
        !url.username &&
        !url.password &&
        !url.hash &&
        [...url.searchParams.keys()].sort().join(",") ===
          "X-Amz-Algorithm,X-Amz-Credential,X-Amz-Date,X-Amz-Expires,X-Amz-Signature,X-Amz-SignedHeaders,partNumber,uploadId" &&
        url.searchParams.get("uploadId") === record.uploadId &&
        url.searchParams.get("partNumber") === "1" &&
        url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
        url.searchParams.get("X-Amz-SignedHeaders") === "content-length;host" &&
        url.searchParams.get("X-Amz-Expires") === "90" &&
        /^[A-Za-z0-9]{16,128}\/\d{8}\/auto\/s3\/aws4_request$/.test(
          url.searchParams.get("X-Amz-Credential") ?? "",
        ) &&
        /^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? ""),
      "DIRECT_NEGATIVE_GRANT_INVALID",
    );
    const date = url.searchParams.get("X-Amz-Date") ?? "";
    checked(/^\d{8}T\d{6}Z$/.test(date), "DIRECT_NEGATIVE_TIME_INVALID");
    const issued = Date.parse(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
    );
    const expiresAt = Date.parse(grant.expiresAt);
    checked(
      Number.isFinite(expiresAt) &&
        expiresAt > Date.now() + 5000 &&
        expiresAt <= Date.now() + 100_000 &&
        Math.abs(expiresAt - issued - 90_000) < 1000,
      "DIRECT_NEGATIVE_TIME_INVALID",
    );
    used = true;
    return bounded(async (signal) => {
      const response = await originalFetch(grant.url, {
        method: "PUT",
        body: fixtureBytes(39),
        headers: { "content-length": "39" },
        redirect: "error",
        credentials: "omit",
        signal,
      });
      const bytes = response.body
        ? await readBodyBounded(response, 16_384, signal)
        : Buffer.alloc(0);
      checked(
        response.status === 403 &&
          /<Code>SignatureDoesNotMatch<\/Code>/.test(bytes.toString("utf8")),
        "DIRECT_EXACT_LENGTH_REJECTION_NOT_PROVEN",
      );
      return {
        type: "put-result",
        seq: 0,
        outcome: "http",
        status: 403,
        errorCode: "SignatureDoesNotMatch",
      };
    });
  };
}

const realClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolveSleep, reject) => {
      const timer = setTimeout(resolveSleep, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("bounded"));
        },
        { once: true },
      );
    }),
};
async function waitPastCutoff(cutoff, clock) {
  checked(Number.isSafeInteger(cutoff) && cutoff < clock.now() + 100_000, "GRANT_CUTOFF_INVALID");
  await bounded(async (signal) => {
    while (clock.now() <= cutoff) await clock.sleep(cutoff - clock.now() + 1, signal);
  }, 100_000);
}

export async function runContinuation(
  options,
  {
    runtime,
    browser,
    directory = MANIFEST_DIRECTORY,
    readPredecessor = readPredecessorManifest,
    clock = realClock,
    timeoutMs,
    dispatchSpacingMs,
    toolingFiles = toolingFileHashes(),
  },
) {
  validateContinuationApproval(options);
  const predecessor = validatePredecessor(readPredecessor(directory));
  const predecessorCutoff = predecessor.fixtures[0].lastDispatchAt + 90_000;
  const document = {
    schema: 1,
    runId: RUN_ID,
    releaseSha: options.releaseSha,
    toolingSha: options.toolingSha,
    toolingFiles,
    bucket: BUCKET,
    prefix: PREFIX,
    continuationId: CONTINUATION_ID,
    originalManifestSha256: ORIGINAL_MANIFEST_SHA256,
    originalStatus: "FAILED",
    createdAt: new Date().toISOString(),
    status: "RESERVED",
    stage: "reserved",
    code: null,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    observationsOnly: true,
    predecessorCutoff,
    latestGrantExpiresAt: null,
    fixtures: FIXTURES.slice(1).map((fixture) => ({
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
  const journal = reserveManifest(document, CONTINUATION_FILENAME, directory);
  let corePassed = false;
  try {
    await waitPastCutoff(predecessorCutoff, clock);
    await bounded(() => assertNoParts(runtime, predecessor.fixtures[0]));
    for (const fixture of FIXTURES) {
      await bounded(() => assertAbsent(runtime, PREFIX + fixture.name));
      await bounded(() => runtime.assertNoExistingAllocation(PREFIX + fixture.name));
    }
    // Recheck immutable bytes/state after read-only preflight and before mutation.
    validatePredecessor(readPredecessor(directory));
    await runReservedAcceptance(options, {
      runtime,
      browser,
      journal,
      continuation: true,
      timeoutMs,
      dispatchSpacingMs,
    });
    corePassed = document.status === "AWAITING_POST_CUTOFF_OBSERVATIONS";
    if (document.fixtures.some((record) => record.debt)) return continuationProof(document);
    if (document.latestGrantExpiresAt !== null) {
      await waitPastCutoff(document.latestGrantExpiresAt, clock);
      for (const record of [predecessor.fixtures[0], ...document.fixtures]) {
        if (record.uploadId) await bounded(() => assertNoParts(runtime, record));
        await bounded(() => assertAbsent(runtime, record.key));
        await bounded(() => runtime.assertNoExistingAllocation(record.key));
      }
      document.stage = "post-grant-cutoff-absence-observed";
      document.postCutoffObservedAt = clock.now();
      for (const record of document.fixtures)
        if (record.create === "acknowledged")
          record.stages.push("post-grant-cutoff-absence-observed");
    }
    if (corePassed) document.status = "OBSERVATIONS_PASSED";
  } catch (error) {
    document.status = "FAILED";
    document.code ??= safeCode(error);
    if (document.latestGrantExpiresAt !== null)
      for (const record of document.fixtures)
        if (record.create === "acknowledged") record.debt = true;
  } finally {
    journal.save();
  }
  return continuationProof(document);
}

function continuationProof(document) {
  return {
    ...publicProof(document),
    type: "continuation-proof",
    continuationId: CONTINUATION_ID,
    toolingSha: document.toolingSha,
    toolingFiles: document.toolingFiles,
    originalManifestSha256: ORIGINAL_MANIFEST_SHA256,
    originalStatus: "FAILED",
    singlePartCompletionCovered: false,
    postCutoffAbsenceObserved:
      document.postCutoffObservedAt > document.latestGrantExpiresAt &&
      document.latestGrantExpiresAt !== null,
  };
}
export function validateContinuationProof(message, releaseSha, toolingSha, toolingFiles) {
  checked(
    message?.schema === 1 &&
      message.type === "continuation-proof" &&
      message.continuationId === CONTINUATION_ID &&
      message.originalManifestSha256 === ORIGINAL_MANIFEST_SHA256 &&
      message.toolingSha === toolingSha &&
      /^[a-f0-9]{40}$/.test(toolingSha ?? "") &&
      ["providerSha256", "continuationSha256"].every(
        (key) =>
          /^[a-f0-9]{64}$/.test(toolingFiles?.[key] ?? "") &&
          message.toolingFiles?.[key] === toolingFiles[key],
      ) &&
      message.originalStatus === "FAILED" &&
      message.singlePartCompletionCovered === false &&
      typeof message.postCutoffAbsenceObserved === "boolean" &&
      message.runId === RUN_ID &&
      message.releaseSha === releaseSha &&
      message.bucket === BUCKET &&
      message.prefix === PREFIX &&
      message.observationsOnly === true &&
      message.activationEnabled === false &&
      message.maxRetainedBytes === MAX_RETAINED_BYTES &&
      ["OBSERVATIONS_PASSED", "FAILED"].includes(message.status) &&
      (message.code === null || /^[A-Z_]{1,80}$/.test(message.code)) &&
      Array.isArray(message.fixtures) &&
      message.fixtures.length === 2,
    "INVALID_CONTINUATION_PROOF",
  );
  const stages = new Set([
    "reserved",
    "signature-capability-verified",
    "all-exact-keys-clear",
    "wrong-length-put-dispatched",
    "wrong-length-provider-rejected-with-no-part",
    "part-1-put-dispatched",
    "part-2-put-dispatched",
    "resume-authoritative-part-one-observed",
    "direct-get-sha256-and-ayin-root-verified",
    "abort-and-absence-observed",
    "owned-object-deletion-and-absence-observed",
    "post-grant-cutoff-absence-observed",
  ]);
  checked(stages.has(message.stage), "INVALID_CONTINUATION_PROOF");
  const fixtures = message.fixtures.map((record, i) => {
    checked(
      record.name === FIXTURES[i + 1].name &&
        record.key === PREFIX + record.name &&
        record.size === FIXTURES[i + 1].size &&
        typeof record.allocationKnown === "boolean" &&
        typeof record.debt === "boolean" &&
        Array.isArray(record.stages) &&
        record.stages.length <= 16 &&
        record.stages.every((stage) => stages.has(stage)),
      "INVALID_CONTINUATION_PROOF",
    );
    for (const state of [record.create, record.complete, record.abort, record.deletion])
      checked(
        [
          "not-dispatched",
          "dispatched-unknown",
          "acknowledged",
          "acknowledged-receipt-discarded",
        ].includes(state),
        "INVALID_CONTINUATION_PROOF",
      );
    return {
      name: record.name,
      key: record.key,
      size: record.size,
      create: record.create,
      allocationKnown: record.allocationKnown,
      complete: record.complete,
      abort: record.abort,
      deletion: record.deletion,
      debt: record.debt,
      stages: [...record.stages],
    };
  });
  if (message.status === "OBSERVATIONS_PASSED") {
    const [multipart, abort] = fixtures;
    checked(
      message.code === null &&
        message.stage === "post-grant-cutoff-absence-observed" &&
        message.postCutoffAbsenceObserved &&
        fixtures.every(
          (record) =>
            record.create === "acknowledged" &&
            record.allocationKnown &&
            !record.debt &&
            record.stages.includes("part-1-put-dispatched") &&
            record.stages.includes("post-grant-cutoff-absence-observed"),
        ) &&
        multipart.complete === "acknowledged-receipt-discarded" &&
        multipart.deletion === "acknowledged" &&
        multipart.abort === "not-dispatched" &&
        abort.abort === "acknowledged" &&
        abort.complete === "not-dispatched" &&
        abort.deletion === "not-dispatched" &&
        [
          "wrong-length-provider-rejected-with-no-part",
          "resume-authoritative-part-one-observed",
          "part-2-put-dispatched",
          "direct-get-sha256-and-ayin-root-verified",
          "owned-object-deletion-and-absence-observed",
        ].every((stage) => multipart.stages.includes(stage)) &&
        abort.stages.includes("abort-and-absence-observed"),
      "INCOMPLETE_CONTINUATION_PROOF",
    );
  }
  return {
    schema: 1,
    type: "continuation-proof",
    continuationId: CONTINUATION_ID,
    toolingSha,
    toolingFiles: {
      providerSha256: toolingFiles.providerSha256,
      continuationSha256: toolingFiles.continuationSha256,
    },
    originalManifestSha256: ORIGINAL_MANIFEST_SHA256,
    originalStatus: "FAILED",
    singlePartCompletionCovered: false,
    postCutoffAbsenceObserved: message.postCutoffAbsenceObserved,
    runId: RUN_ID,
    releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    observationsOnly: true,
    activationEnabled: false,
    maxRetainedBytes: MAX_RETAINED_BYTES,
    status: message.status,
    stage: message.stage,
    code: message.code,
    fixtures,
  };
}

async function main() {
  const options = parseContinuationArguments(process.argv.slice(2));
  const toolingFiles = validateStagedTooling(options);
  const originalFetch = globalThis.fetch;
  const runtime = await productionRuntime(options, { activeRelease: true });
  runtime.directNegativeProbe = createDirectNegativeProbe(runtime.r2Origin, originalFetch);
  process.stdout.write(
    JSON.stringify({ type: "ready", r2Origin: runtime.r2Origin, releaseSha: options.releaseSha }) +
      "\n",
  );
  const proof = await runContinuation(options, {
    runtime,
    browser: makeJsonlChannel(process.stdin, process.stdout),
    toolingFiles,
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
