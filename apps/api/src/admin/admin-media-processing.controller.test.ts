import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { MediaUploadError } from "../media/media-upload-error.js";
import { AdminMediaProcessingController } from "./admin-media-processing.controller.js";
vi.mock("../media/media-generation-safety.js", () => ({
  lockMediaGeneration: vi.fn(),
  hasActiveMediaJob: vi.fn(async () => false),
  hasNewerMediaGeneration: vi.fn(),
}));
const videoId = "11111111-1111-4111-8111-111111111111";
function fixture(failure: Error) {
  const audit = { recordInTransaction: vi.fn() };
  const service = new AdminMediaProcessingController(
    { client: { $transaction: (work: (tx: object) => unknown) => work({}) } } as never,
    {} as never,
    { createReprocessJob: vi.fn().mockRejectedValue(failure) } as never,
    {} as never,
    audit as never,
  );
  return { service, audit };
}
describe("finite output admission HTTP boundary", () => {
  it.each([
    ["UPLOAD_OUTPUT_ADMISSION_BUSY", 409],
    ["UPLOAD_CANARY_BUSY", 429],
    ["UPLOAD_RECOVERY_UNSUPPORTED", 503],
  ] as const)("preserves %s as status %s instead of a generic 500", async (code, status) => {
    const f = fixture(new MediaUploadError(code, "Bounded admission rejected.", status));
    const error = await f.service
      .reprocess({ ayinAuth: { accountId: videoId } } as never, videoId)
      .catch((value) => value);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual({
      error: { code, message: "Bounded admission rejected." },
    });
    expect(f.audit.recordInTransaction).not.toHaveBeenCalled();
  });
  it("does not disguise an unexpected transaction error as a policy rejection", async () => {
    const unexpected = new Error("database failure");
    const f = fixture(unexpected);
    await expect(
      f.service.reprocess({ ayinAuth: { accountId: videoId } } as never, videoId),
    ).rejects.toBe(unexpected);
  });
});
