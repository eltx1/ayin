import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaUploadService, type UploadActor } from "./media-upload.service.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import { UploadRateLimiter } from "./upload-rate-limiter.js";
import { UploadSessionTokenService } from "./upload-session-token.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const actor = { accountId, sessionId, authVersion: 1 } as UploadActor;
const sizeBytes = 70 * 1024 ** 2;

type Change = "SESSION_REVOKED" | "ACCOUNT_SUSPENDED" | "AUTH_VERSION_CHANGED" | "NONE";
type Operation = "authorizePart" | "resumeParts" | "complete" | "abort";
function fixture(change: Change, changeDuringProvider = true) {
  let revoked = !changeDuringProvider && change === "SESSION_REVOKED";
  const account = {
    status: !changeDuringProvider && change === "ACCOUNT_SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    authVersion: !changeDuringProvider && change === "AUTH_VERSION_CHANGED" ? 2 : 1,
  };
  const asset = {
    channelId,
    videoId: null,
    kind: "SOURCE_VIDEO",
    removedAt: null,
    r2ObjectKey: `channels/${channelId}/media/${assetId}/source.mp4`,
    sizeBytes: BigInt(sizeBytes),
    mimeType: "video/mp4",
    status: "PENDING",
    uploadIntegrityRequired: false,
  };
  const tx = {
    channelMember: {
      findFirst: vi.fn(async () => ({ id: "membership" })),
      findMany: vi.fn(async () => [{ accountId }]),
    },
    account: { findUnique: vi.fn(async () => account) },
    mediaAsset: {
      findUnique: vi.fn(async () => asset),
      update: vi.fn(),
      aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 0n } })),
      create: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async (sql: { strings: string[] } | TemplateStringsArray) => {
      const query = ("strings" in sql ? sql.strings : sql).join("?");
      if (query.includes('AS bytes FROM "MediaUploadSession"')) return [{ bytes: 0n }];
      if (query.includes('FROM "AccountSession"')) return revoked ? [] : [{ id: sessionId }];
      if (query.includes('FROM "ChannelMember"')) return [{ accountId }];
      if (query.includes('FROM "Channel"')) return [{ status: "ACTIVE", removedAt: null }];
      return [{ id: accountId }];
    }),
  };
  const invalidate = () => {
    if (!changeDuringProvider) return;
    if (change === "SESSION_REVOKED") revoked = true;
    if (change === "ACCOUNT_SUSPENDED") account.status = "SUSPENDED";
    if (change === "AUTH_VERSION_CHANGED") account.authVersion = 2;
  };
  const storage = {
    available: true,
    createMultipartUpload: vi.fn(async () => ({ uploadId: "isolated-created" })),
    authorizeMultipartPart: vi.fn(async () => {
      invalidate();
      return { url: "https://example.invalid/part", expiresAt: new Date(Date.now() + 60_000) };
    }),
    listParts: vi.fn(async () => {
      invalidate();
      return [];
    }),
    completeMultipartUpload: vi.fn(async () => {
      invalidate();
      return { etag: "complete" };
    }),
    headObject: vi.fn(async () => ({ sizeBytes, contentType: "video/mp4" })),
    abortMultipartUpload: vi.fn(async () => invalidate()),
  };
  const lifecycle = { enqueueUploadedAssetInTransaction: vi.fn() };
  const config = loadMediaStorageConfig({ APP_ENV: "test" });
  const tokens = new UploadSessionTokenService(config);
  const token = tokens.sign({
    version: 1,
    accountId,
    channelId,
    assetId,
    objectKey: asset.r2ObjectKey,
    uploadId: "isolated-multipart",
    mode: "multipart",
    mimeType: "video/mp4",
    sizeBytes,
    partSizeBytes: config.partSizeBytes,
    expiresAtMs: Date.now() + 900_000,
  });
  const service = new MediaUploadService(
    { client: { ...tx, $transaction: (run: (value: typeof tx) => unknown) => run(tx) } } as never,
    {
      get: vi.fn(async (key: string) =>
        key === "uploadMaxSizeBytes" ? 5 * 1024 ** 3 : 100 * 1024 ** 3,
      ),
    } as never,
    storage as never,
    config,
    tokens,
    lifecycle as never,
    new UploadRateLimiter(),
  );
  const run = (operation: Operation) => {
    if (operation === "authorizePart") return service.authorizePart(actor, token, 1);
    if (operation === "complete")
      return service.complete(
        actor,
        token,
        Array.from({ length: 5 }, (_, index) => ({ partNumber: index + 1, etag: `part-${index}` })),
      );
    return service[operation](actor, token);
  };
  return { run, tx, lifecycle, storage, service };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("ordinary owner current upload authority", () => {
  for (const change of ["SESSION_REVOKED", "ACCOUNT_SUSPENDED", "AUTH_VERSION_CHANGED"] as const) {
    it.each(["authorizePart", "resumeParts", "complete", "abort"] as const)(
      `rejects %s when ${change} wins during provider I/O`,
      async (operation) => {
        const f = fixture(change);
        const error = await f.run(operation).catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(401);
        expect(f.tx.mediaAsset.update).not.toHaveBeenCalled();
        expect(f.lifecycle.enqueueUploadedAssetInTransaction).not.toHaveBeenCalled();
      },
    );
  }
  it("rejects revoked owner authority before issuing a provider request", async () => {
    const f = fixture("SESSION_REVOKED", false);
    await expect(f.run("authorizePart")).rejects.toBeInstanceOf(HttpException);
    expect(f.storage.authorizeMultipartPart).not.toHaveBeenCalled();
  });
  it("does not issue a legacy part grant beyond the upload session deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const f = fixture("NONE");
    vi.advanceTimersByTime(890_000);
    await f.run("authorizePart");
    expect(f.storage.authorizeMultipartPart).toHaveBeenCalledWith(
      expect.objectContaining({ expiresInSeconds: 10 }),
    );
  });

  it("refuses a fresh part grant when less than one signing second remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const f = fixture("NONE");
    vi.advanceTimersByTime(899_001);
    await expect(f.run("authorizePart")).rejects.toMatchObject({
      code: "INVALID_UPLOAD_SESSION",
      statusCode: 401,
    });
    expect(f.storage.authorizeMultipartPart).not.toHaveBeenCalled();
  });

  it("applies the production creation limit to every direct service caller", async () => {
    vi.useFakeTimers();
    vi.stubEnv("APP_ENV", "production");
    const f = fixture("NONE");
    const input = { channelId, sizeBytes, mimeType: "video/mp4" };
    for (let index = 0; index < 12; index += 1) await f.service.createSession(actor, input);
    await expect(f.service.createSession(actor, input)).rejects.toMatchObject({
      code: "UPLOAD_RATE_LIMITED",
      statusCode: 429,
    });
    expect(f.storage.createMultipartUpload).toHaveBeenCalledTimes(12);
  });
});
