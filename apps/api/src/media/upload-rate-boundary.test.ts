import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaUploadController } from "./media-upload.controller.js";
import { MediaUploadRecoveryController } from "./media-upload-recovery.controller.js";
import { UploadRateLimiter, UPLOAD_REQUEST_LIMITS } from "./upload-rate-limiter.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const request = { ayinAuth: { accountId: "account-a" }, query: {} } as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("APP_ENV", "production");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("upload HTTP rate boundaries", () => {
  it("maps the real production create-session limit to HTTP 429 rather than a server error", async () => {
    const limiter = new UploadRateLimiter();
    const uploads = {
      createSession: vi.fn(async () => {
        limiter.consume("create:account-a");
        return { assetId: sessionId };
      }),
    };
    const controller = new MediaUploadController(uploads as never);
    const input = { channelId: sessionId, sizeBytes: 1_024, mimeType: "video/mp4" };
    for (let index = 0; index < 12; index += 1) await controller.createSession(request, input);
    const failure = await controller.createSession(request, input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect((failure as HttpException).getResponse()).toEqual({
      error: {
        code: "UPLOAD_RATE_LIMITED",
        message: "Too many upload requests. Try again shortly.",
      },
    });
    expect(uploads.createSession).toHaveBeenCalledTimes(13);
  });

  it("allows all 26 parts of a 128 MiB upload at the supported 5 MiB part size", async () => {
    const commands = {
      authorize: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
    };
    const controller = new MediaUploadRecoveryController(
      {} as never,
      commands as never,
      new UploadRateLimiter(),
    );
    for (let partNumber = 1; partNumber <= Math.ceil(128 / 5); partNumber += 1) {
      await controller.authorize(request, sessionId, {
        requestId,
        expectedRevision: 1,
        partNumber,
      });
    }
    await controller.complete(request, sessionId, { requestId, expectedRevision: 1 });
    expect(commands.authorize).toHaveBeenCalledTimes(26);
    expect(commands.complete).toHaveBeenCalledOnce();
  });
  it("bounds authorization bursts without consuming completion or cancellation capacity", async () => {
    const commands = {
      authorize: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
    };
    const controller = new MediaUploadRecoveryController(
      {} as never,
      commands as never,
      new UploadRateLimiter(),
    );
    const input = { requestId, expectedRevision: 1, partNumber: 1 };
    for (let index = 0; index < UPLOAD_REQUEST_LIMITS.authorization; index += 1) {
      await controller.authorize(request, sessionId, input);
    }
    const failure = await controller
      .authorize(request, sessionId, input)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    await controller.complete(request, sessionId, { requestId, expectedRevision: 1 });
    await controller.cancel(request, sessionId, { requestId, expectedRevision: 1 });
    expect(commands.complete).toHaveBeenCalledOnce();
    expect(commands.cancel).toHaveBeenCalledOnce();
  });
});
