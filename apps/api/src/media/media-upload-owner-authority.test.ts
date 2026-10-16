import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import type { MediaUploadSession } from "@ayin/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformSettingCatalog } from "../platform-config/platform-settings.catalog.js";
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
function fixture(
  change: Change,
  changeDuringProvider = true,
  options: { partSizeBytes?: number; maximumBytes?: number } = {},
) {
  let revoked = !changeDuringProvider && change === "SESSION_REVOKED";
  const account = {
    status: !changeDuringProvider && change === "ACCOUNT_SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    authVersion: !changeDuringProvider && change === "AUTH_VERSION_CHANGED" ? 2 : 1,
  };
  let cancelled: MediaUploadSession | null = null;
  const asset = {
    channelId,
    videoId: null,
    kind: "SOURCE_VIDEO",
    removedAt: null as Date | null,
    r2ObjectKey: `channels/${channelId}/media/${assetId}/source.mp4`,
    sizeBytes: BigInt(sizeBytes),
    mimeType: "video/mp4",
    status: "PENDING",
    uploadIntegrityRequired: false,
    get uploadSession() {
      return cancelled;
    },
  };
  const tx = {
    channelMember: {
      findFirst: vi.fn(async () => ({ id: "membership" })),
      findMany: vi.fn(async () => [{ accountId }]),
    },
    account: { findUnique: vi.fn(async () => account) },
    mediaAsset: {
      findUnique: vi.fn(async () => asset),
      findUniqueOrThrow: vi.fn(async () => asset),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(asset, data);
        return asset;
      }),
      aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 0n } })),
      create: vi.fn(),
    },
    mediaUploadSession: {
      findUnique: vi.fn(async () => cancelled),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // The real DB trigger retains this irreversible marker for every source
        // sidecar, including terminal cancellation custody with no identity.
        asset.uploadIntegrityRequired = true;
        cancelled = {
          ...data,
          id: "55555555-5555-4555-8555-555555555555",
          revision: 1,
        } as MediaUploadSession;
        return cancelled;
      }),
    },
    privacyMediaDeletionJob: { createMany: vi.fn() },
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
  const config = loadMediaStorageConfig({
    APP_ENV: "test",
    ...(options.partSizeBytes ? { R2_PART_SIZE_BYTES: String(options.partSizeBytes) } : {}),
  });
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
        key === "uploadMaxSizeBytes" ? (options.maximumBytes ?? 5 * 1024 ** 3) : 100 * 1024 ** 3,
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
  return { run, tx, lifecycle, storage, service, tokens };
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
  it("finalizes only its exact terminal cancellation while retaining the database integrity marker", async () => {
    const f = fixture("NONE");
    await expect(f.run("abort")).resolves.toEqual({ status: "ABORTED" });
    await expect(f.run("abort")).resolves.toEqual({ status: "ABORTED" });
    expect(f.tx.mediaUploadSession.create).toHaveBeenCalledOnce();
    expect(f.tx.privacyMediaDeletionJob.createMany).toHaveBeenCalledOnce();
    expect(f.tx.mediaAsset.update).toHaveBeenCalledOnce();
    expect(await f.tx.mediaAsset.findUnique()).toMatchObject({
      status: "REJECTED",
      uploadIntegrityRequired: true,
    });
    for (const operation of ["authorizePart", "resumeParts", "complete"] as const)
      await expect(f.run(operation)).rejects.toMatchObject({
        code: "UPLOAD_STATE_CHANGED",
        statusCode: 409,
      });
    expect(f.storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(f.storage.listParts).not.toHaveBeenCalled();
    expect(f.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(f.lifecycle.enqueueUploadedAssetInTransaction).not.toHaveBeenCalled();
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
  it.each([
    [5 * 1024 ** 2, 10_000 * 5 * 1024 ** 2, 5 * 1024 ** 2],
    [5 * 1024 ** 2, 10_000 * 5 * 1024 ** 2 + 1, 5 * 1024 ** 2 + 1],
    [5 * 1024 ** 2, 50 * 1024 ** 3, Math.ceil((50 * 1024 ** 3) / 10_000)],
    [16 * 1024 ** 2, 50 * 1024 ** 3, 16 * 1024 ** 2],
    [5 * 1024 ** 3, 50 * 1024 ** 3, 5 * 1024 ** 3],
  ])(
    "keeps allowed multipart source %i/%i within 10,000 parts",
    async (configuredPartBytes, sourceBytes, expectedPartBytes) => {
      vi.useFakeTimers();
      const maximumBytes = 50 * 1024 ** 3;
      expect(platformSettingCatalog.uploadMaxSizeBytes.schema.safeParse(maximumBytes).success).toBe(
        true,
      );
      const f = fixture("NONE", true, { partSizeBytes: configuredPartBytes, maximumBytes });
      const session = await f.service.createSession(actor, {
        channelId,
        sizeBytes: sourceBytes,
        mimeType: "video/mp4",
      });
      expect(session.mode).toBe("multipart");
      if (session.mode !== "multipart") throw new Error("Expected multipart fixture.");
      expect(session.partSizeBytes).toBe(expectedPartBytes);
      expect(session.partCount).toBeLessThanOrEqual(10_000);
      expect(session.partCount).toBe(Math.ceil(sourceBytes / session.partSizeBytes));
      const finalPartBytes = sourceBytes - (session.partCount - 1) * session.partSizeBytes;
      expect(finalPartBytes).toBeGreaterThan(0);
      expect(finalPartBytes).toBeLessThanOrEqual(session.partSizeBytes);
      const signed = f.tokens.verify(session.sessionToken);
      expect(signed.partSizeBytes).toBe(session.partSizeBytes);
      expect(signed.sizeBytes).toBe(sourceBytes);
      expect(f.storage.createMultipartUpload).toHaveBeenCalledOnce();
    },
  );

  it("still rejects a source above the approved business maximum before allocating multipart storage", async () => {
    vi.useFakeTimers();
    const maximumBytes = 50 * 1024 ** 3;
    const f = fixture("NONE", true, { partSizeBytes: 5 * 1024 ** 2, maximumBytes });
    await expect(
      f.service.createSession(actor, {
        channelId,
        sizeBytes: maximumBytes + 1,
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ code: "VIDEO_TOO_LARGE", statusCode: 413 });
    expect(f.storage.createMultipartUpload).not.toHaveBeenCalled();
  });
});
