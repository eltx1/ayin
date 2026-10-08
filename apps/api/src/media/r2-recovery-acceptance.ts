import { createHash, randomUUID } from "node:crypto";

import { hashUploadFileIdentity } from "@ayin/types";

import {
  MediaStorageObservationError,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type UploadCompletionObservationInput,
  type UploadObjectBinding,
} from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";
import { R2HttpError, R2SigV4 } from "./r2-sigv4.js";
import {
  matchUploadCompletionObject,
  objectMetadataFromHeaders,
  uploadBindingHeaders,
} from "./r2-upload-completion.js";

const PREFIX = "ayin-recovery-acceptance/";
const PART_BYTES = 5 * 1024 * 1024;
const TAIL_BYTES = 17;
const CONTENT_TYPE = "application/octet-stream";
const REQUEST_DEADLINE_MS = 30_000;
const URL_TTL_SECONDS = 60;

export interface R2RecoveryAcceptanceOptions {
  // This must be separately authorized by the operator. It permits destruction
  // of this invocation's exact synthetic fixtures only, never imported targets.
  cleanupOwnedFixtures?: boolean;
}

type AcceptanceStorage = Pick<
  MediaStorageAdapter,
  | "authorizeSinglePut"
  | "createMultipartUpload"
  | "authorizeMultipartPart"
  | "listParts"
  | "completeMultipartUpload"
  | "abortMultipartUpload"
  | "headObject"
  | "deleteObject"
> & {
  observeUploadCompletion: NonNullable<MediaStorageAdapter["observeUploadCompletion"]>;
};

// Supplying a runtime always labels results SIMULATED, even if the caller
// mistakenly supplies an implementation that contacts a real provider.
export interface R2RecoveryAcceptanceRuntime {
  storage: AcceptanceStorage;
  put: (url: string, input: RequestInit) => Promise<Response>;
  options: (url: string, input: RequestInit) => Promise<Response>;
  get: (key: string, signal: AbortSignal) => Promise<Response>;
}

interface Fixture {
  purpose: "SINGLE" | "MULTIPART_RECOVERY" | "ABORT_PROBE";
  key: string;
  uploadId: string | null;
  maximumBytes: number;
  object: "NOT_CREATED" | "MAY_EXIST" | "CREATED" | "ABSENCE_OBSERVED";
  multipart: "NOT_CREATED" | "MAY_EXIST_WITH_UNKNOWN_ID" | "CREATED" | "NO_SUCH_UPLOAD_OBSERVED";
}

export interface R2RecoveryAcceptanceReport {
  version: "AYIN_R2_RECOVERY_ACCEPTANCE_V1";
  status: "DISABLED" | "BLOCKED" | "FAILED" | "OBSERVATIONS_PARTIAL" | "OBSERVATIONS_VERIFIED";
  provenance: "NOT_RUN" | "SIMULATED" | "REAL_R2";
  networkAttempted: boolean;
  // These observations cannot prove the absence of delayed/future writes.
  settlementProven: false;
  issuanceEnabled: false;
  checks: Array<{
    name: string;
    status: "VERIFIED" | "NOT_RUN_APPROVAL_REQUIRED" | "NOT_RUN_MISSING_ORIGIN";
  }>;
  cleanup: "NOT_REQUESTED" | "OBSERVATIONS_RECORDED" | "INCOMPLETE";
  failure?: { stage: string; code: string };
  // Operational addresses for private, separately approved cleanup. No account,
  // credentials, signed URLs, provider diagnostics or source digests are emitted.
  ownership?: {
    bucket: string;
    runId: string;
    prefix: string;
    fixtures: Fixture[];
  };
}

class AcceptanceFailure extends Error {
  constructor(readonly code: string) {
    super("The isolated R2 acceptance observation was not verified.");
  }
}

function checked(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AcceptanceFailure(code);
}

function configuration(environment: NodeJS.ProcessEnv): MediaStorageConfig {
  const account = environment.AYIN_R2_ACCEPTANCE_ACCOUNT_ID;
  const bucket = environment.AYIN_R2_ACCEPTANCE_BUCKET;
  const access = environment.AYIN_R2_ACCEPTANCE_ACCESS_KEY_ID;
  const secret = environment.AYIN_R2_ACCEPTANCE_SECRET_ACCESS_KEY;
  checked(
    account && bucket && access && secret && environment.AYIN_R2_ACCEPTANCE_PREFIX,
    "EXPLICIT_TEST_CONFIGURATION_REQUIRED",
  );
  checked(/^[a-f0-9]{32}$/.test(account), "INVALID_TEST_ACCOUNT");
  checked(
    /^ayin-recovery-test-[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])?$/.test(bucket) &&
      !/(?:^|-)(?:prod|production)(?:-|$)/.test(bucket),
    "TEST_ONLY_BUCKET_REQUIRED",
  );
  checked(
    environment.APP_ENV !== "production" && bucket !== environment.R2_BUCKET?.trim(),
    "PRODUCTION_CONFIGURATION_REFUSED",
  );
  checked(environment.AYIN_R2_ACCEPTANCE_PREFIX === PREFIX, "FIXED_TEST_PREFIX_REQUIRED");
  checked(
    [access, secret].every((value) => value.length <= 256 && /^[\x21-\x7e]+$/.test(value)),
    "INVALID_TEST_CREDENTIAL_FORMAT",
  );
  return {
    mode: "r2",
    appEnv: "test",
    accountId: account,
    bucket,
    accessKeyId: access,
    secretAccessKey: secret,
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: "auto",
    uploadUrlTtlSeconds: URL_TTL_SECONDS,
    partSizeBytes: PART_BYTES,
    multipartThresholdBytes: PART_BYTES,
    uploadSessionSecret: "acceptance-only-unused-no-session-issuance",
  };
}

function realRuntime(config: MediaStorageConfig): R2RecoveryAcceptanceRuntime {
  const signer = new R2SigV4(config);
  return {
    storage: new R2MediaStorageAdapter(config),
    put: (url, input) => fetch(url, { ...input, redirect: "error" }),
    options: (url, input) => fetch(url, { ...input, redirect: "error" }),
    get: (key, signal) => signer.request({ method: "GET", key, signal }),
  };
}

async function timed<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AcceptanceFailure("REQUEST_TIMEOUT"));
    }, REQUEST_DEADLINE_MS);
  });
  try {
    return await Promise.race([deadline, work(controller.signal)]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function* bytesSource(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function bindingFor(bytes: Uint8Array): Promise<UploadObjectBinding> {
  return {
    sessionId: randomUUID(),
    sourceAssetId: randomUUID(),
    contentIdentityDigest: (await hashUploadFileIdentity(bytesSource(bytes), bytes.byteLength))
      .rootSha256,
  };
}

async function putBytes(
  runtime: R2RecoveryAcceptanceRuntime,
  url: string,
  bytes: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
  origin?: string,
): Promise<string> {
  return timed(async (signal) => {
    const response = await runtime.put(url, {
      method: "PUT",
      headers: { ...headers, ...(origin ? { origin } : {}) },
      body: bytes,
      signal,
      redirect: "error",
    });
    void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    checked(response.ok, "PUT_REJECTED");
    if (origin) {
      checked(
        response.headers.get("access-control-allow-origin") === origin,
        "PUT_CORS_ORIGIN_MISMATCH",
      );
      checked(
        headerTokens(response, "access-control-expose-headers").includes("etag"),
        "PUT_CORS_ETAG_NOT_EXPOSED",
      );
    }
    const etag = response.headers.get("etag");
    checked(
      etag && etag.length <= 256 && /^"[\x21\x23-\x2b\x2d-\x5b\x5d-\x7e]+"$/.test(etag),
      "PUT_ETAG_INVALID",
    );
    return etag;
  });
}

function headerTokens(response: Response, header: string): string[] {
  return (response.headers.get(header) ?? "").split(",").map((value) => value.trim().toLowerCase());
}

function acceptanceOrigin(environment: NodeJS.ProcessEnv): string | undefined {
  const origin = environment.AYIN_R2_ACCEPTANCE_ORIGIN;
  if (origin === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new AcceptanceFailure("EXACT_HTTPS_ORIGIN_REQUIRED");
  }
  checked(url.protocol === "https:" && url.origin === origin, "EXACT_HTTPS_ORIGIN_REQUIRED");
  return origin;
}

async function verifyCorsPreflight(
  runtime: R2RecoveryAcceptanceRuntime,
  url: string,
  origin: string,
  requestedHeaders: string[],
): Promise<void> {
  await timed(async (signal) => {
    const response = await runtime.options(url, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PUT",
        ...(requestedHeaders.length
          ? { "access-control-request-headers": requestedHeaders.join(",") }
          : {}),
      },
      signal,
      redirect: "error",
    });
    void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    checked(response.ok, "CORS_PREFLIGHT_REJECTED");
    checked(response.headers.get("access-control-allow-origin") === origin, "CORS_ORIGIN_MISMATCH");
    checked(
      headerTokens(response, "access-control-allow-methods").includes("put"),
      "CORS_PUT_NOT_ALLOWED",
    );
    const allowed = headerTokens(response, "access-control-allow-headers");
    checked(
      requestedHeaders.every((header) => allowed.includes(header.toLowerCase())),
      "CORS_REQUIRED_HEADER_MISSING",
    );
  });
}

function exactParts(actual: ExistingUploadPart[], expected: ExistingUploadPart[]): void {
  checked(
    actual.length === expected.length &&
      actual.every(
        (part, index) =>
          part.partNumber === expected[index]!.partNumber &&
          part.sizeBytes === expected[index]!.sizeBytes &&
          part.etag === expected[index]!.etag,
      ),
    "EXACT_PART_LIST_MISMATCH",
  );
}

async function verifyDownloadedBytes(
  runtime: R2RecoveryAcceptanceRuntime,
  expected: UploadCompletionObservationInput,
  source: Uint8Array,
): Promise<void> {
  await timed(async (signal) => {
    const response = await runtime.get(expected.key, signal);
    if (signal.aborted) void response.body?.cancel().catch(() => undefined);
    signal.throwIfAborted();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => {
      if (reader) void reader.cancel().catch(() => undefined);
      else void response.body?.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      checked(response.ok, "GET_REJECTED");
      checked(
        matchUploadCompletionObject(objectMetadataFromHeaders(response.headers), expected.expected)
          .status === "OBJECT_VERIFIED",
        "GET_BINDING_MISMATCH",
      );
      checked(response.body, "GET_BODY_MISSING");
      reader = response.body.getReader();
      const activeReader = reader;
      const sha256 = createHash("sha256");
      async function* chunks(): AsyncIterable<Uint8Array> {
        let received = 0;
        while (true) {
          signal.throwIfAborted();
          const next = await activeReader.read();
          signal.throwIfAborted();
          if (next.done) break;
          received += next.value.byteLength;
          checked(received <= expected.expected.sizeBytes, "GET_BYTE_LIMIT_EXCEEDED");
          sha256.update(next.value);
          yield next.value;
        }
        checked(received === expected.expected.sizeBytes, "GET_BYTE_COUNT_MISMATCH");
      }
      const actual = await hashUploadFileIdentity(chunks(), expected.expected.sizeBytes, {
        signal,
      });
      checked(
        actual.rootSha256 === expected.expected.binding.contentIdentityDigest &&
          sha256.digest("hex") === createHash("sha256").update(source).digest("hex"),
        "GET_FULL_BYTE_IDENTITY_MISMATCH",
      );
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
    }
  });
}

async function confirmNoSuchUpload(storage: AcceptanceStorage, fixture: Fixture): Promise<void> {
  checked(fixture.uploadId, "OWNED_UPLOAD_ID_REQUIRED");
  try {
    await storage.listParts({ key: fixture.key, uploadId: fixture.uploadId });
  } catch (error) {
    if (
      error instanceof MediaStorageObservationError &&
      error.code === "NO_SUCH_UPLOAD" &&
      error.operation === "listParts" &&
      error.providerStatus === 404
    ) {
      fixture.multipart = "NO_SUCH_UPLOAD_OBSERVED";
      return;
    }
    throw error;
  }
  throw new AcceptanceFailure("UPLOAD_STILL_OBSERVED");
}

async function requireObjectAbsent(storage: AcceptanceStorage, key: string): Promise<void> {
  try {
    await timed(() => storage.headObject(key));
  } catch (error) {
    if (error instanceof R2HttpError && error.method === "HEAD" && error.status === 404) return;
    throw error;
  }
  throw new AcceptanceFailure("OBJECT_NOT_ABSENT");
}

async function cleanupCreatedFixtures(
  runtime: R2RecoveryAcceptanceRuntime,
  fixtures: Fixture[],
): Promise<boolean> {
  let allObserved = true;
  // Only the in-memory ledger from this invocation can reach this function.
  // No bucket/prefix inventory, imported manifest, or guessed upload ID is used.
  for (const fixture of fixtures) {
    if (fixture.uploadId && fixture.multipart === "CREATED") {
      try {
        try {
          const uploadId = fixture.uploadId;
          await timed(() => runtime.storage.abortMultipartUpload({ key: fixture.key, uploadId }));
        } catch (error) {
          if (
            !(error instanceof R2HttpError) ||
            error.status !== 404 ||
            error.providerCode !== "NoSuchUpload"
          )
            throw error;
        }
        await confirmNoSuchUpload(runtime.storage, fixture);
      } catch {
        allObserved = false;
      }
    }
    if (fixture.object === "CREATED") {
      try {
        await timed(() => runtime.storage.deleteObject(fixture.key));
        await requireObjectAbsent(runtime.storage, fixture.key);
        fixture.object = "ABSENCE_OBSERVED";
      } catch {
        allObserved = false;
      }
    }
    if (fixture.object === "MAY_EXIST" || fixture.multipart === "MAY_EXIST_WITH_UNKNOWN_ID")
      allObserved = false;
  }
  return allObserved;
}

export async function runR2RecoveryAcceptance(
  environment: NodeJS.ProcessEnv,
  options: R2RecoveryAcceptanceOptions = {},
  simulatedRuntimeFactory?: (config: MediaStorageConfig) => R2RecoveryAcceptanceRuntime,
): Promise<R2RecoveryAcceptanceReport> {
  const report: R2RecoveryAcceptanceReport = {
    version: "AYIN_R2_RECOVERY_ACCEPTANCE_V1",
    status: "DISABLED",
    provenance: "NOT_RUN",
    networkAttempted: false,
    settlementProven: false,
    issuanceEnabled: false,
    checks: [],
    cleanup: "NOT_REQUESTED",
  };
  if (environment.AYIN_R2_ACCEPTANCE_ENABLED !== "1") return report;
  let config: MediaStorageConfig;
  let origin: string | undefined;
  try {
    config = configuration(environment);
    origin = acceptanceOrigin(environment);
    checked(
      !options.cleanupOwnedFixtures || environment.AYIN_R2_ACCEPTANCE_CLEANUP_APPROVED === "1",
      "EXPLICIT_DESTRUCTIVE_FIXTURE_APPROVAL_REQUIRED",
    );
  } catch (error) {
    report.status = "BLOCKED";
    report.failure = {
      stage: "CONFIGURATION",
      code: error instanceof AcceptanceFailure ? error.code : "INVALID_CONFIGURATION",
    };
    return report;
  }

  const runId = randomUUID();
  const prefix = `${PREFIX}${runId}/`;
  const fixtures: Fixture[] = [
    ["SINGLE", "single.bin", 38],
    ["MULTIPART_RECOVERY", "multipart.bin", PART_BYTES + TAIL_BYTES],
    ["ABORT_PROBE", "abort.bin", PART_BYTES],
  ].map(([purpose, suffix, maximumBytes]) => ({
    purpose: purpose as Fixture["purpose"],
    key: `${prefix}${suffix}`,
    uploadId: null,
    maximumBytes: maximumBytes as number,
    object: "NOT_CREATED",
    multipart: "NOT_CREATED",
  }));
  report.ownership = { bucket: config.bucket!, runId, prefix, fixtures };
  report.provenance = simulatedRuntimeFactory ? "SIMULATED" : "REAL_R2";
  const verified = (name: string) => report.checks.push({ name, status: "VERIFIED" });
  let runtime: R2RecoveryAcceptanceRuntime | undefined;
  let stage = "INITIALIZE";
  try {
    runtime = simulatedRuntimeFactory ? simulatedRuntimeFactory(config) : realRuntime(config);
    const { storage } = runtime;
    const single = fixtures[0]!;
    const multipart = fixtures[1]!;
    const abort = fixtures[2]!;
    const singleBytes = new Uint8Array(38).fill(0x53);
    const multipartBytes = new Uint8Array(PART_BYTES + TAIL_BYTES).fill(0x4d);
    multipartBytes.fill(0x54, PART_BYTES);
    const abortBytes = new Uint8Array(PART_BYTES).fill(0x41);
    const bindings = await Promise.all([singleBytes, multipartBytes, abortBytes].map(bindingFor));
    const expected = (
      fixture: Fixture,
      binding: UploadObjectBinding,
    ): UploadCompletionObservationInput => ({
      key: fixture.key,
      uploadId: fixture.uploadId,
      expected: { sizeBytes: fixture.maximumBytes, contentType: CONTENT_TYPE, binding },
    });

    stage = "FRESH_KEYS_ABSENT";
    report.networkAttempted = !simulatedRuntimeFactory;
    for (const fixture of fixtures) await requireObjectAbsent(storage, fixture.key);
    verified(stage);

    stage = "SINGLE_PUT";
    const singleGrant = await storage.authorizeSinglePut({
      key: single.key,
      contentType: CONTENT_TYPE,
      uploadBinding: bindings[0]!,
      expiresInSeconds: URL_TTL_SECONDS,
    });
    const singleHeaders = { "content-type": CONTENT_TYPE, ...uploadBindingHeaders(bindings[0]!) };
    stage = "NODE_SINGLE_CORS_PROTOCOL";
    if (origin) {
      await verifyCorsPreflight(runtime, singleGrant.url, origin, Object.keys(singleHeaders));
    } else report.checks.push({ name: stage, status: "NOT_RUN_MISSING_ORIGIN" });
    stage = "SINGLE_PUT";
    single.object = "MAY_EXIST";
    await putBytes(runtime, singleGrant.url, singleBytes, singleHeaders, origin);
    if (origin) verified("NODE_SINGLE_CORS_PROTOCOL");
    single.object = "CREATED";
    stage = "SINGLE_BOUND_HEAD";
    checked(
      (await storage.observeUploadCompletion(expected(single, bindings[0]!))).status ===
        "OBJECT_VERIFIED",
      "SINGLE_OBJECT_NOT_VERIFIED",
    );
    verified(stage);
    stage = "SINGLE_FULL_BYTES";
    await verifyDownloadedBytes(runtime, expected(single, bindings[0]!), singleBytes);
    verified(stage);

    stage = "MULTIPART_CREATE";
    multipart.multipart = "MAY_EXIST_WITH_UNKNOWN_ID";
    const created = await storage.createMultipartUpload({
      key: multipart.key,
      contentType: CONTENT_TYPE,
      uploadBinding: bindings[1]!,
    });
    multipart.uploadId = created.uploadId;
    multipart.multipart = "CREATED";
    const uploadPart = async (
      fixture: Fixture,
      partNumber: number,
      bytes: Uint8Array<ArrayBuffer>,
    ) => {
      checked(fixture.uploadId, "OWNED_UPLOAD_ID_REQUIRED");
      const grant = await storage.authorizeMultipartPart({
        key: fixture.key,
        uploadId: fixture.uploadId,
        partNumber,
        expiresInSeconds: URL_TTL_SECONDS,
      });
      if (fixture === multipart && partNumber === 1) {
        if (origin) await verifyCorsPreflight(runtime!, grant.url, origin, []);
        else
          report.checks.push({
            name: "NODE_MULTIPART_CORS_PROTOCOL",
            status: "NOT_RUN_MISSING_ORIGIN",
          });
      }
      const etag = await putBytes(runtime!, grant.url, bytes, {}, origin);
      if (origin && fixture === multipart && partNumber === 1)
        verified("NODE_MULTIPART_CORS_PROTOCOL");
      return {
        partNumber,
        etag,
        sizeBytes: bytes.byteLength,
      };
    };
    stage = "MULTIPART_PART1_RESUME";
    const firstPart = await uploadPart(multipart, 1, multipartBytes.subarray(0, PART_BYTES));
    exactParts(await storage.listParts({ key: multipart.key, uploadId: created.uploadId }), [
      firstPart,
    ]);
    checked(
      (await storage.observeUploadCompletion(expected(multipart, bindings[1]!))).status ===
        "MULTIPART_PRESENT",
      "MULTIPART_PRESENCE_NOT_VERIFIED",
    );
    verified(stage);
    stage = "MULTIPART_TWO_EXACT_PARTS";
    const secondPart = await uploadPart(multipart, 2, multipartBytes.subarray(PART_BYTES));
    const parts = await storage.listParts({ key: multipart.key, uploadId: created.uploadId });
    exactParts(parts, [firstPart, secondPart]);
    verified(stage);

    stage = "MULTIPART_COMPLETE_RESPONSE_DISCARDED";
    multipart.object = "MAY_EXIST";
    // Deliberate response-loss simulation: Complete is issued exactly once and
    // its successful result is discarded. No receipt/ETag is used to reconcile.
    await storage.completeMultipartUpload({
      key: multipart.key,
      uploadId: created.uploadId,
      parts,
    });
    multipart.object = "CREATED";
    verified(stage);
    stage = "MULTIPART_RECONCILED_BOUND_HEAD";
    checked(
      (await storage.observeUploadCompletion(expected(multipart, bindings[1]!))).status ===
        "OBJECT_VERIFIED",
      "MULTIPART_OBJECT_NOT_VERIFIED",
    );
    multipart.multipart = "NO_SUCH_UPLOAD_OBSERVED";
    verified(stage);
    stage = "MULTIPART_FULL_BYTES";
    await verifyDownloadedBytes(runtime, expected(multipart, bindings[1]!), multipartBytes);
    verified(stage);

    stage = "ABORT_PROBE_CREATE";
    abort.multipart = "MAY_EXIST_WITH_UNKNOWN_ID";
    const abortCreated = await storage.createMultipartUpload({
      key: abort.key,
      contentType: CONTENT_TYPE,
      uploadBinding: bindings[2]!,
    });
    abort.uploadId = abortCreated.uploadId;
    abort.multipart = "CREATED";
    stage = "ABORT_PROBE_PART_PRESENT";
    const abortPart = await uploadPart(abort, 1, abortBytes);
    exactParts(await storage.listParts({ key: abort.key, uploadId: abort.uploadId }), [abortPart]);
    verified(stage);
    if (options.cleanupOwnedFixtures) {
      stage = "ABORT_NO_SUCH_UPLOAD";
      const abortUploadId = abort.uploadId;
      await timed(() => storage.abortMultipartUpload({ key: abort.key, uploadId: abortUploadId }));
      await confirmNoSuchUpload(storage, abort);
      verified(stage);
      stage = "ABORT_OBJECT_ABSENT";
      checked(
        (await storage.observeUploadCompletion(expected(abort, bindings[2]!))).status ===
          "OBJECT_ABSENT",
        "ABORT_OBJECT_NOT_ABSENT",
      );
      abort.object = "ABSENCE_OBSERVED";
      verified(stage);
      report.status = origin ? "OBSERVATIONS_VERIFIED" : "OBSERVATIONS_PARTIAL";
    } else {
      for (const name of ["ABORT_NO_SUCH_UPLOAD", "ABORT_OBJECT_ABSENT"])
        report.checks.push({ name, status: "NOT_RUN_APPROVAL_REQUIRED" });
      report.status = "OBSERVATIONS_PARTIAL";
    }
  } catch (error) {
    report.status = "FAILED";
    report.failure = {
      stage,
      code: error instanceof AcceptanceFailure ? error.code : "OBSERVATION_FAILED",
    };
  } finally {
    if (options.cleanupOwnedFixtures && runtime) {
      const observed = await cleanupCreatedFixtures(runtime, fixtures);
      report.cleanup = observed ? "OBSERVATIONS_RECORDED" : "INCOMPLETE";
      if (!observed && report.status !== "FAILED") {
        report.status = "FAILED";
        report.failure = {
          stage: "EXACT_OWNED_FIXTURE_CLEANUP",
          code: "CLEANUP_OBSERVATION_INCOMPLETE",
        };
      }
    }
  }
  return report;
}

export function r2RecoveryAcceptanceExitCode(status: R2RecoveryAcceptanceReport["status"]): 0 | 1 {
  return status === "OBSERVATIONS_VERIFIED" ? 0 : 1;
}
