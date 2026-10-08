import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MediaStorageObservationError,
  type StoredObjectMetadata,
  type UploadObjectBinding,
} from "./media-storage.adapter.js";
import {
  r2RecoveryAcceptanceExitCode,
  runR2RecoveryAcceptance,
  type R2RecoveryAcceptanceRuntime,
} from "./r2-recovery-acceptance.js";
import { R2HttpError } from "./r2-sigv4.js";
import { matchUploadCompletionObject, uploadBindingHeaders } from "./r2-upload-completion.js";

const PART_BYTES = 5 * 1024 * 1024;
const environment: NodeJS.ProcessEnv = {
  AYIN_R2_ACCEPTANCE_ENABLED: "1",
  AYIN_R2_ACCEPTANCE_ACCOUNT_ID: "a".repeat(32),
  AYIN_R2_ACCEPTANCE_BUCKET: "ayin-recovery-test-fixture",
  AYIN_R2_ACCEPTANCE_ACCESS_KEY_ID: "synthetic-access-private",
  AYIN_R2_ACCEPTANCE_SECRET_ACCESS_KEY: "synthetic-secret-private",
  AYIN_R2_ACCEPTANCE_PREFIX: "ayin-recovery-acceptance/",
  AYIN_R2_ACCEPTANCE_ORIGIN: "https://acceptance.example.test",
};
const cleanupEnvironment = { ...environment, AYIN_R2_ACCEPTANCE_CLEANUP_APPROVED: "1" };

interface ObjectData {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  binding: UploadObjectBinding;
  etag: string;
}
interface MultipartData extends Omit<ObjectData, "bytes" | "etag"> {
  key: string;
  parts: Map<number, { bytes: Uint8Array<ArrayBuffer>; etag: string }>;
}

function offline() {
  const objects = new Map<string, ObjectData>();
  const uploads = new Map<string, MultipartData>();
  let nextId = 0;
  const metadata = (object: ObjectData): StoredObjectMetadata => ({
    sizeBytes: object.bytes.byteLength,
    contentType: object.contentType,
    uploadBinding: object.binding,
    etag: object.etag,
  });
  const storage: R2RecoveryAcceptanceRuntime["storage"] = {
    authorizeSinglePut: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["authorizeSinglePut"]>(
      async (input) => ({
        url: `https://acceptance.invalid/${encodeURIComponent(input.key)}?signature=private-signed-url`,
        expiresAt: new Date(),
      }),
    ),
    createMultipartUpload: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["createMultipartUpload"]>(
      async (input) => {
        const uploadId = `synthetic-upload-${++nextId}`;
        uploads.set(uploadId, {
          key: input.key,
          contentType: input.contentType,
          binding: input.uploadBinding!,
          parts: new Map(),
        });
        return { uploadId };
      },
    ),
    authorizeMultipartPart: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["authorizeMultipartPart"]>(
      async (input) => ({
        url: `https://acceptance.invalid/${encodeURIComponent(input.key)}?uploadId=${input.uploadId}&partNumber=${input.partNumber}&signature=private-signed-url`,
        expiresAt: new Date(),
      }),
    ),
    listParts: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["listParts"]>(async (input) => {
      const upload = uploads.get(input.uploadId);
      if (!upload || upload.key !== input.key)
        throw new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404);
      return [...upload.parts.entries()].map(([partNumber, part]) => ({
        partNumber,
        etag: part.etag,
        sizeBytes: part.bytes.byteLength,
      }));
    }),
    completeMultipartUpload: vi.fn<
      R2RecoveryAcceptanceRuntime["storage"]["completeMultipartUpload"]
    >(async (input) => {
      const upload = uploads.get(input.uploadId)!;
      const parts = input.parts.map((part) => upload.parts.get(part.partNumber)!);
      const bytes = new Uint8Array(parts.reduce((size, part) => size + part.bytes.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part.bytes, offset);
        offset += part.bytes.byteLength;
      }
      objects.set(input.key, { ...upload, bytes, etag: '"multi-etag"' });
      uploads.delete(input.uploadId);
      return { etag: "ignored-completion-result-private" };
    }),
    abortMultipartUpload: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["abortMultipartUpload"]>(
      async (input) => {
        uploads.delete(input.uploadId);
      },
    ),
    headObject: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["headObject"]>(async (key) => {
      const object = objects.get(key);
      if (!object) throw new R2HttpError(404, "HEAD");
      return metadata(object);
    }),
    observeUploadCompletion: vi.fn<
      R2RecoveryAcceptanceRuntime["storage"]["observeUploadCompletion"]
    >(async (input) => {
      if (input.uploadId && uploads.has(input.uploadId)) return { status: "MULTIPART_PRESENT" };
      const object = objects.get(input.key);
      return object
        ? matchUploadCompletionObject(metadata(object), input.expected)
        : { status: "OBJECT_ABSENT" };
    }),
    deleteObject: vi.fn<R2RecoveryAcceptanceRuntime["storage"]["deleteObject"]>(async (key) => {
      objects.delete(key);
    }),
  };
  const runtime: R2RecoveryAcceptanceRuntime = {
    storage,
    put: vi.fn(async (url, input) => {
      const parsed = new URL(url);
      const key = decodeURIComponent(parsed.pathname.slice(1));
      const bytes = new Uint8Array(input.body as Uint8Array<ArrayBuffer>);
      const uploadId = parsed.searchParams.get("uploadId");
      if (uploadId) {
        const partNumber = Number(parsed.searchParams.get("partNumber"));
        const etag = `"part-${partNumber}"`;
        uploads.get(uploadId)!.parts.set(partNumber, { bytes, etag });
        return new Response(null, {
          headers: {
            etag,
            "access-control-allow-origin": environment.AYIN_R2_ACCEPTANCE_ORIGIN!,
            "access-control-expose-headers": "ETag",
          },
        });
      }
      const headers = new Headers(input.headers);
      objects.set(key, {
        bytes,
        contentType: headers.get("content-type")!,
        binding: {
          sessionId: headers.get("x-amz-meta-ayin-upload-session")!,
          sourceAssetId: headers.get("x-amz-meta-ayin-source-asset")!,
          contentIdentityDigest: headers.get("x-amz-meta-ayin-identity-root")!,
        },
        etag: '"single-etag"',
      });
      return new Response(null, {
        headers: {
          etag: '"single-etag"',
          "access-control-allow-origin": environment.AYIN_R2_ACCEPTANCE_ORIGIN!,
          "access-control-expose-headers": "ETag",
        },
      });
    }),
    options: vi.fn(async (_url, input) => {
      const headers = new Headers(input.headers);
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": headers.get("origin")!,
          "access-control-allow-methods": "GET, PUT",
          "access-control-allow-headers": headers.get("access-control-request-headers") ?? "",
        },
      });
    }),
    get: vi.fn(async (key) => {
      const object = objects.get(key)!;
      return new Response(object.bytes, {
        headers: {
          "content-length": String(object.bytes.byteLength),
          "content-type": object.contentType,
          ...uploadBindingHeaders(object.binding),
          etag: object.etag,
        },
      });
    }),
  };
  const factory = vi.fn(() => runtime);
  return { runtime, storage, factory, objects, uploads };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isolated R2 recovery acceptance safety gate", () => {
  it("does nothing by default, including with ordinary production R2 credentials", async () => {
    const factory = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await runR2RecoveryAcceptance(
      {
        R2_ACCOUNT_ID: "production",
        R2_BUCKET: "production",
        R2_ACCESS_KEY_ID: "private",
        R2_SECRET_ACCESS_KEY: "private",
      },
      {},
      factory,
    );
    expect(result).toMatchObject({
      status: "DISABLED",
      provenance: "NOT_RUN",
      networkAttempted: false,
    });
    expect(result.ownership).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(r2RecoveryAcceptanceExitCode(result.status)).toBe(1);
  });

  it.each([
    ["missing test credential", { AYIN_R2_ACCEPTANCE_SECRET_ACCESS_KEY: undefined }],
    ["ordinary bucket", { AYIN_R2_ACCEPTANCE_BUCKET: "ayin-media" }],
    ["production-marked bucket", { AYIN_R2_ACCEPTANCE_BUCKET: "ayin-recovery-test-production" }],
    ["actual configured bucket", { R2_BUCKET: environment.AYIN_R2_ACCEPTANCE_BUCKET }],
    [
      "padded actual configured bucket",
      { R2_BUCKET: ` ${environment.AYIN_R2_ACCEPTANCE_BUCKET} ` },
    ],
    ["production process", { APP_ENV: "production" }],
    ["custom prefix", { AYIN_R2_ACCEPTANCE_PREFIX: "channels/" }],
    ["caller-selected run", { AYIN_R2_ACCEPTANCE_PREFIX: "ayin-recovery-acceptance/previous/" }],
    ["non-HTTPS origin", { AYIN_R2_ACCEPTANCE_ORIGIN: "http://test.example" }],
    ["origin containing path", { AYIN_R2_ACCEPTANCE_ORIGIN: "https://test.example/path" }],
    ["endpoint injection", { AYIN_R2_ACCEPTANCE_ACCOUNT_ID: "evil.invalid/?private" }],
    ["control character credential", { AYIN_R2_ACCEPTANCE_ACCESS_KEY_ID: "private\nheader" }],
  ])("refuses %s before constructing a runtime or making a request", async (_label, overrides) => {
    const fixture = offline();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await runR2RecoveryAcceptance(
      { ...environment, ...overrides },
      {},
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "BLOCKED",
      provenance: "NOT_RUN",
      networkAttempted: false,
    });
    expect(fixture.factory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.ownership).toBeUndefined();
  });

  it("requires separate cleanup acknowledgment and a programmatic flag", async () => {
    const fixture = offline();
    const blocked = await runR2RecoveryAcceptance(
      environment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(blocked.failure?.code).toBe("EXPLICIT_DESTRUCTIVE_FIXTURE_APPROVAL_REQUIRED");
    expect(fixture.factory).not.toHaveBeenCalled();
    const result = await runR2RecoveryAcceptance(cleanupEnvironment, {}, fixture.factory);
    expect(result.status).toBe("OBSERVATIONS_PARTIAL");
    expect(fixture.storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
  });

  it("does not overwrite an observed preexisting object or delete it", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.headObject).mockResolvedValueOnce({
      sizeBytes: 1,
      contentType: "text/plain",
      etag: '"existing"',
    });
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "FAILED",
      failure: { stage: "FRESH_KEYS_ABSENT", code: "OBJECT_NOT_ABSENT" },
    });
    expect(fixture.runtime.put).not.toHaveBeenCalled();
    expect(fixture.storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
    expect(fixture.storage.abortMultipartUpload).not.toHaveBeenCalled();
  });
});

describe("synthetic acceptance orchestration, not physical R2 evidence", () => {
  it("verifies single and resumed multipart bytes, drops the Complete receipt and retains all fixtures by default", async () => {
    const fixture = offline();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result).toMatchObject({
      status: "OBSERVATIONS_PARTIAL",
      provenance: "SIMULATED",
      networkAttempted: false,
      settlementProven: false,
      issuanceEnabled: false,
      cleanup: "NOT_REQUESTED",
    });
    expect(result.checks.filter((check) => check.status === "VERIFIED")).toHaveLength(11);
    expect(
      result.checks.slice(-2).every((check) => check.status === "NOT_RUN_APPROVAL_REQUIRED"),
    ).toBe(true);
    expect(result.ownership?.prefix).toMatch(/^ayin-recovery-acceptance\/[0-9a-f-]{36}\/$/);
    expect(result.ownership?.fixtures.map((item) => item.maximumBytes)).toEqual([
      38,
      PART_BYTES + 17,
      PART_BYTES,
    ]);
    expect(fixture.objects.size).toBe(2);
    expect(fixture.uploads.size).toBe(1);
    expect(fixture.storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.put).toHaveBeenCalledTimes(4);
    expect(fixture.runtime.get).toHaveBeenCalledTimes(2);
    expect(fixture.storage.authorizeMultipartPart).toHaveBeenCalledTimes(3);
    expect(fixture.storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-access-private|synthetic-secret-private|private-signed-url|ignored-completion-result-private|contentIdentityDigest|X-Amz/,
    );
    const singleInput = vi.mocked(fixture.storage.authorizeSinglePut).mock.calls[0]![0];
    expect(singleInput.uploadBinding?.contentIdentityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(singleInput.expiresInSeconds).toBe(60);
    expect(fixture.runtime.put).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: {
          "content-type": "application/octet-stream",
          ...uploadBindingHeaders(singleInput.uploadBinding!),
          origin: environment.AYIN_R2_ACCEPTANCE_ORIGIN,
        },
        redirect: "error",
      }),
    );
  });

  it("uses fresh run addresses for every invocation and ignores endpoint/key overrides", async () => {
    const first = offline();
    const second = offline();
    const overrides = {
      ...environment,
      AYIN_R2_ACCEPTANCE_ENDPOINT: "https://evil.invalid",
      AYIN_R2_ACCEPTANCE_KEY: "channels/preexisting.mp4",
    };
    const a = await runR2RecoveryAcceptance(overrides, {}, first.factory);
    const b = await runR2RecoveryAcceptance(overrides, {}, second.factory);
    expect(a.ownership!.prefix).not.toBe(b.ownership!.prefix);
    expect(first.factory).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
        appEnv: "test",
        region: "auto",
      }),
    );
    for (const result of [a, b])
      expect(
        result.ownership!.fixtures.every((item) => item.key.startsWith(result.ownership!.prefix)),
      ).toBe(true);
  });

  it("aborts and deletes only this invocation's exact created IDs and keys after explicit approval", async () => {
    const fixture = offline();
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "OBSERVATIONS_VERIFIED",
      provenance: "SIMULATED",
      cleanup: "OBSERVATIONS_RECORDED",
      settlementProven: false,
      issuanceEnabled: false,
    });
    expect(result.checks).toHaveLength(13);
    expect(result.checks.every((check) => check.status === "VERIFIED")).toBe(true);
    expect(fixture.objects.size).toBe(0);
    expect(fixture.uploads.size).toBe(0);
    const owned = result.ownership!.fixtures;
    expect(fixture.storage.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith({
      key: owned[2]!.key,
      uploadId: owned[2]!.uploadId,
    });
    expect(vi.mocked(fixture.storage.deleteObject).mock.calls).toEqual([
      [owned[0]!.key],
      [owned[1]!.key],
    ]);
    expect(owned.every((item) => item.object === "ABSENCE_OBSERVED")).toBe(true);
    expect(owned.slice(1).every((item) => item.multipart === "NO_SUCH_UPLOAD_OBSERVED")).toBe(true);
    expect(r2RecoveryAcceptanceExitCode(result.status)).toBe(0);
  });

  it("refuses a mismatched HEAD without using object existence as success", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.observeUploadCompletion).mockResolvedValueOnce({
      status: "OBJECT_MISMATCH",
    });
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result).toMatchObject({
      status: "FAILED",
      failure: { stage: "SINGLE_BOUND_HEAD", code: "SINGLE_OBJECT_NOT_VERIFIED" },
    });
    expect(fixture.runtime.get).not.toHaveBeenCalled();
    expect(fixture.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects unexpected parts rather than completing an altered upload", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.listParts).mockResolvedValueOnce([
      { partNumber: 2, etag: '"wrong"', sizeBytes: PART_BYTES },
    ]);
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result.failure).toEqual({
      stage: "MULTIPART_PART1_RESUME",
      code: "EXACT_PART_LIST_MISMATCH",
    });
    expect(fixture.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("preserves uncertain allocations without guessing IDs, listing prefixes or replaying Create", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.createMultipartUpload).mockRejectedValueOnce(
      new Error("private-signed-url synthetic-secret-private"),
    );
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "FAILED",
      cleanup: "INCOMPLETE",
      failure: { stage: "MULTIPART_CREATE", code: "OBSERVATION_FAILED" },
    });
    expect(result.ownership!.fixtures[1]).toMatchObject({
      uploadId: null,
      multipart: "MAY_EXIST_WITH_UNKNOWN_ID",
    });
    expect(fixture.storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(fixture.storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-signed-url|synthetic-secret-private/);
  });

  it("does not replay failed Complete or delete an unconfirmed possibly created object", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.completeMultipartUpload).mockRejectedValueOnce(
      new Error("lost response with private diagnostics"),
    );
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "FAILED",
      cleanup: "INCOMPLETE",
      failure: { stage: "MULTIPART_COMPLETE_RESPONSE_DISCARDED", code: "OBSERVATION_FAILED" },
    });
    expect(fixture.storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(result.ownership!.fixtures[1]!.object).toBe("MAY_EXIST");
    expect(vi.mocked(fixture.storage.deleteObject).mock.calls).toEqual([
      [result.ownership!.fixtures[0]!.key],
    ]);
    expect(fixture.storage.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith({
      key: result.ownership!.fixtures[1]!.key,
      uploadId: result.ownership!.fixtures[1]!.uploadId,
    });
  });

  it("does not interpret an abort acknowledgment as NoSuchUpload or object absence", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.abortMultipartUpload).mockImplementation(async () => undefined);
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "FAILED",
      cleanup: "INCOMPLETE",
      failure: { stage: "ABORT_NO_SUCH_UPLOAD", code: "UPLOAD_STILL_OBSERVED" },
    });
    expect(result.checks.some((check) => check.name === "ABORT_OBJECT_ABSENT")).toBe(false);
  });

  it("preserves failed cleanup and sanitizes provider errors instead of reporting success", async () => {
    const fixture = offline();
    vi.mocked(fixture.storage.deleteObject).mockRejectedValue(
      new Error("provider credentials synthetic-secret-private"),
    );
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result).toMatchObject({
      status: "FAILED",
      cleanup: "INCOMPLETE",
      failure: { stage: "EXACT_OWNED_FIXTURE_CLEANUP", code: "CLEANUP_OBSERVATION_INCOMPLETE" },
    });
    expect(result.ownership!.fixtures[0]!.object).toBe("CREATED");
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-private");
  });
});

describe("bounded exact provider-byte verification", () => {
  it.each(["changed", "short", "oversized", "wrong-metadata"])(
    "rejects %s GET even after a verified HEAD",
    async (mutation) => {
      const fixture = offline();
      const original = vi.mocked(fixture.runtime.get).getMockImplementation()!;
      vi.mocked(fixture.runtime.get).mockImplementationOnce(async (key, signal) => {
        const response = await original(key, signal);
        const object = fixture.objects.get(key)!;
        const bytes =
          mutation === "short"
            ? object.bytes.slice(1)
            : mutation === "oversized"
              ? new Uint8Array(object.bytes.length + 1)
              : object.bytes.slice();
        if (mutation === "changed") bytes[0] = bytes[0]! ^ 1;
        if (mutation === "wrong-metadata")
          response.headers.set(
            "x-amz-meta-ayin-source-asset",
            "00000000-0000-4000-8000-000000000000",
          );
        return new Response(bytes, { headers: response.headers });
      });
      const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
      expect(result.status).toBe("FAILED");
      expect(result.failure?.stage).toBe("SINGLE_FULL_BYTES");
      expect(fixture.storage.createMultipartUpload).not.toHaveBeenCalled();
    },
  );

  it("checks the streamed byte bound and cancels instead of calling arrayBuffer", async () => {
    const fixture = offline();
    const original = vi.mocked(fixture.runtime.get).getMockImplementation()!;
    const cancel = vi.fn();
    const arrayBuffer = vi.fn();
    vi.mocked(fixture.runtime.get).mockImplementationOnce(async (key, signal) => {
      const originalResponse = await original(key, signal);
      const response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(39));
          },
          cancel,
        }),
        { headers: originalResponse.headers },
      );
      response.arrayBuffer = arrayBuffer;
      return response;
    });
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result.failure?.code).toBe("GET_BYTE_LIMIT_EXCEEDED");
    expect(cancel).toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("bounds a stalled GET body and cancels the reader on deadline", async () => {
    vi.useFakeTimers();
    const fixture = offline();
    const original = vi.mocked(fixture.runtime.get).getMockImplementation()!;
    const cancel = vi.fn();
    vi.mocked(fixture.runtime.get).mockImplementationOnce(async (key, signal) => {
      const response = await original(key, signal);
      return new Response(new ReadableStream({ cancel }), { headers: response.headers });
    });
    const pending = runR2RecoveryAcceptance(environment, {}, fixture.factory);
    await vi.waitFor(() => expect(fixture.runtime.get).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending;
    expect(result).toMatchObject({
      status: "FAILED",
      failure: { stage: "SINGLE_FULL_BYTES", code: "REQUEST_TIMEOUT" },
    });
    expect(cancel).toHaveBeenCalled();
  });
});

describe("optional Node CORS protocol observations", () => {
  it("marks both checks unrun and keeps acceptance partial when no origin is supplied", async () => {
    const fixture = offline();
    const result = await runR2RecoveryAcceptance(
      { ...cleanupEnvironment, AYIN_R2_ACCEPTANCE_ORIGIN: undefined },
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result.status).toBe("OBSERVATIONS_PARTIAL");
    expect(
      result.checks
        .filter((check) => check.status === "NOT_RUN_MISSING_ORIGIN")
        .map((check) => check.name),
    ).toEqual(["NODE_SINGLE_CORS_PROTOCOL", "NODE_MULTIPART_CORS_PROTOCOL"]);
    expect(fixture.runtime.options).not.toHaveBeenCalled();
    expect(r2RecoveryAcceptanceExitCode(result.status)).toBe(1);
  });

  it("checks exact metadata preflight headers on SINGLE, PUT on multipart, and ETag exposure on actual PUT", async () => {
    const fixture = offline();
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result.status).toBe("OBSERVATIONS_VERIFIED");
    expect(fixture.runtime.options).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(fixture.runtime.options).mock.calls;
    const singleHeaders = new Headers(calls[0]![1].headers);
    expect(singleHeaders.get("access-control-request-headers")!.split(",").sort()).toEqual([
      "content-type",
      "x-amz-meta-ayin-identity-root",
      "x-amz-meta-ayin-source-asset",
      "x-amz-meta-ayin-upload-session",
    ]);
    for (const [, input] of calls) {
      expect(input.method).toBe("OPTIONS");
      expect(new Headers(input.headers).get("origin")).toBe(environment.AYIN_R2_ACCEPTANCE_ORIGIN);
      expect(new Headers(input.headers).get("access-control-request-method")).toBe("PUT");
      expect(input.redirect).toBe("error");
    }
  });

  it.each([
    [
      "wrong origin",
      { "access-control-allow-origin": "https://other.example" },
      "CORS_ORIGIN_MISMATCH",
    ],
    ["wildcard origin", { "access-control-allow-origin": "*" }, "CORS_ORIGIN_MISMATCH"],
    ["missing PUT", { "access-control-allow-methods": "GET" }, "CORS_PUT_NOT_ALLOWED"],
    [
      "metadata headers omitted",
      { "access-control-allow-headers": "content-type" },
      "CORS_REQUIRED_HEADER_MISSING",
    ],
  ])("rejects %s before dispatching the SINGLE PUT", async (_label, changes, code) => {
    const fixture = offline();
    const original = vi.mocked(fixture.runtime.options).getMockImplementation()!;
    vi.mocked(fixture.runtime.options).mockImplementationOnce(async (url, input) => {
      const response = await original(url, input);
      for (const [name, value] of Object.entries(changes)) response.headers.set(name, value);
      return response;
    });
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result.failure).toEqual({ stage: "NODE_SINGLE_CORS_PROTOCOL", code });
    expect(fixture.runtime.put).not.toHaveBeenCalled();
  });

  it("matches header names and methods case-insensitively", async () => {
    const fixture = offline();
    const original = vi.mocked(fixture.runtime.options).getMockImplementation()!;
    vi.mocked(fixture.runtime.options).mockImplementation(async (url, input) => {
      const response = await original(url, input);
      response.headers.set(
        "access-control-allow-headers",
        response.headers.get("access-control-allow-headers")!.toUpperCase(),
      );
      response.headers.set("access-control-allow-methods", "put");
      return response;
    });
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result.status).toBe("OBSERVATIONS_VERIFIED");
  });

  it("rejects missing ETag exposure on multipart PUT without completing or replaying the part", async () => {
    const fixture = offline();
    const original = vi.mocked(fixture.runtime.put).getMockImplementation()!;
    vi.mocked(fixture.runtime.put).mockImplementation(async (url, input) => {
      const response = await original(url, input);
      if (new URL(url).searchParams.has("uploadId"))
        response.headers.delete("access-control-expose-headers");
      return response;
    });
    const result = await runR2RecoveryAcceptance(environment, {}, fixture.factory);
    expect(result.failure).toEqual({
      stage: "MULTIPART_PART1_RESUME",
      code: "PUT_CORS_ETAG_NOT_EXPOSED",
    });
    expect(fixture.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(fixture.runtime.put).toHaveBeenCalledTimes(2);
  });
});

describe("exact abort evidence and outer control-plane deadlines", () => {
  it.each([
    [
      "wrong operation",
      new MediaStorageObservationError("NO_SUCH_UPLOAD", "listMultipartUploads", 404),
    ],
    ["wrong status", new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 500)],
    ["missing status", new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts")],
  ])("rejects %s rather than accepting unrelated absence evidence", async (_label, injected) => {
    const fixture = offline();
    const original = vi.mocked(fixture.storage.listParts).getMockImplementation()!;
    vi.mocked(fixture.storage.listParts).mockImplementation(async (input) => {
      try {
        return await original(input);
      } catch {
        throw injected;
      }
    });
    const result = await runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    expect(result.status).toBe("FAILED");
    expect(result.failure?.stage).toBe("ABORT_NO_SUCH_UPLOAD");
    expect(result.checks.some((check) => check.name === "ABORT_NO_SUCH_UPLOAD")).toBe(false);
    expect(result.ownership!.fixtures[2]!.multipart).toBe("CREATED");
  });

  it("bounds a provider HEAD that never settles even if it ignores its internal abort signal", async () => {
    vi.useFakeTimers();
    const fixture = offline();
    vi.mocked(fixture.storage.headObject).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const pending = runR2RecoveryAcceptance(environment, {}, fixture.factory);
    await vi.waitFor(() => expect(fixture.storage.headObject).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await pending;
    expect(result.failure).toEqual({ stage: "FRESH_KEYS_ABSENT", code: "REQUEST_TIMEOUT" });
    expect(fixture.runtime.put).not.toHaveBeenCalled();
  });

  it("bounds each owned object DELETE rather than hanging finalization indefinitely", async () => {
    vi.useFakeTimers();
    const fixture = offline();
    vi.mocked(fixture.storage.deleteObject).mockImplementation(() => new Promise(() => undefined));
    const pending = runR2RecoveryAcceptance(
      cleanupEnvironment,
      { cleanupOwnedFixtures: true },
      fixture.factory,
    );
    await vi.waitFor(() => expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_001);
    const result = await pending;
    expect(result).toMatchObject({
      status: "FAILED",
      cleanup: "INCOMPLETE",
      failure: { stage: "EXACT_OWNED_FIXTURE_CLEANUP", code: "CLEANUP_OBSERVATION_INCOMPLETE" },
    });
    expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(2);
  });
});
