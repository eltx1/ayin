import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.service.js";
import { MediaUploadRecoveryCommandsService } from "../media/media-upload-recovery-commands.service.js";
import { QuickUploadController } from "./quick-upload.controller.js";
import { QuickUploadError, QuickUploadService } from "./quick-upload.service.js";
import { VideoMetadataService } from "./video-metadata.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const actor = { accountId, authVersion: 1, sessionId: "current-session" };
const limits = {
  actorAccountId: accountId,
  channelId,
  maxFileSizeBytes: 5 * 1024 ** 3,
  channelQuotaBytes: 100 * 1024 ** 3,
  usedStorageBytes: 0,
  availableStorageBytes: 100 * 1024 ** 3,
  multipartThresholdBytes: 64 * 1024 ** 2,
  partSizeBytes: 16 * 1024 ** 2,
  uploadSessionTtlSeconds: 86400,
  storageAvailable: true,
};

describe("quick upload recovery capability HTTP contract", () => {
  let app: NestFastifyApplication;
  const uploadCapabilities = vi.fn<QuickUploadService["uploadCapabilities"]>();
  const capability = vi.fn<MediaUploadRecoveryCommandsService["capability"]>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [QuickUploadController],
      providers: [
        { provide: AuthService, useValue: { authenticate: async () => actor } },
        { provide: DatabaseService, useValue: {} },
        { provide: QuickUploadService, useValue: { uploadCapabilities } },
        { provide: MediaUploadRecoveryCommandsService, useValue: { capability } },
        { provide: VideoMetadataService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    uploadCapabilities.mockResolvedValue(limits);
    capability.mockResolvedValue({ protocolVersion: 1, supported: true, reason: null });
  });

  afterAll(async () => {
    await app?.close();
  });

  function read(authenticated = true) {
    return app.inject({
      method: "GET",
      url: `/creator/videos/upload-capabilities?channelId=${channelId}`,
      headers: authenticated ? { cookie: "ayin_session=synthetic-session" } : {},
    });
  }

  it("keeps standard upload available when legacy recovery has no source size bound", async () => {
    const response = await read();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      ...limits,
      durableRecovery: { supported: false, maxFileSizeBytes: null },
    });
    expect(uploadCapabilities).toHaveBeenCalledExactlyOnceWith(accountId, channelId);
    expect(capability).toHaveBeenCalledExactlyOnceWith(actor, channelId);
  });

  it("preserves the bounded recovery limit independently of the ordinary upload maximum", async () => {
    capability.mockResolvedValue({
      protocolVersion: 1,
      supported: true,
      reason: null,
      maxSourceBytes: 128 * 1024 ** 2,
    });
    expect((await read()).json()).toEqual({
      ...limits,
      durableRecovery: { supported: true, maxFileSizeBytes: 128 * 1024 ** 2 },
    });
  });

  it("preserves standard upload when recovery is explicitly unavailable", async () => {
    capability.mockResolvedValue({ protocolVersion: 1, supported: false, reason: "UNSUPPORTED" });
    expect((await read()).json()).toEqual({
      ...limits,
      durableRecovery: { supported: false, maxFileSizeBytes: null },
    });
  });

  it("does not substitute fallback for an ownership denial", async () => {
    uploadCapabilities.mockRejectedValue(
      new QuickUploadError("CHANNEL_OWNER_REQUIRED", "Denied", 403),
    );
    expect((await read()).statusCode).toBe(403);
    expect(capability).not.toHaveBeenCalled();
  });

  it("requires authentication before revealing any upload capability", async () => {
    expect((await read(false)).statusCode).toBe(401);
    expect(uploadCapabilities).not.toHaveBeenCalled();
    expect(capability).not.toHaveBeenCalled();
  });
});
