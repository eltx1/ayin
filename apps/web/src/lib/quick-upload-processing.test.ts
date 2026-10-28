import { describe, expect, it } from "vitest";
import type { QuickProcessingStatus } from "./quick-upload";
import { describeQuickProcessing } from "./quick-upload-processing";
import { uploadText } from "./upload-copy";

function response(
  status: NonNullable<QuickProcessingStatus["processing"]>["status"] = "PROCESSING",
): QuickProcessingStatus {
  return {
    videoId: "11111111-1111-4111-8111-111111111111",
    ready: false,
    videoStatus: "VALIDATING",
    processing: {
      generation: 1,
      status,
      stage: "FFMPEG_TRANSCODING",
      progressPercent: 20,
      errorCode: null,
      errorMessage: null,
      attempt: 1,
      completedAt: null,
    },
  };
}

describe("quick upload processing feedback", () => {
  it.each(["INGESTING", "QUEUED", "PROCESSING", "UPLOADING", "VERIFYING", "READY"] as const)(
    "continues automatic reads without declaring a slow %s job failed",
    (status) => {
      expect(describeQuickProcessing(response(status), 29).checkNeeded).toBe(false);
      const paused = describeQuickProcessing(response(status), 30);
      expect(paused.checkNeeded).toBe(false);
      expect(paused.message).toContain("still processing");
      expect(paused.label).not.toMatch(/Failed|Cancelled|^Ready$/);
    },
  );

  it("keeps an absent job pending instead of assuming failure", () => {
    const pending = describeQuickProcessing({ ...response(), processing: null }, 30);
    expect(pending.label).toBe("Waiting for status");
    expect(pending.message).toContain("still processing");
    expect(pending.stageLabel).toBeNull();
  });

  it.each([
    ["FAILED", "Failed", "Processing failed."],
    ["CANCELLED", "Cancelled", "Processing was cancelled."],
  ] as const)("distinguishes actual %s from a polling pause", (status, label, message) => {
    for (const reads of [1, 30]) {
      const terminal = describeQuickProcessing(response(status), reads);
      expect(terminal.checkNeeded).toBe(true);
      expect(terminal.label).toBe(label);
      expect(terminal.message).toContain(message);
      expect(terminal.message).not.toContain("Automatic checks are paused");
      expect(terminal.stageLabel).toBeNull();
    }
  });

  it("requires authoritative playback readiness and clears a paused result on recheck", () => {
    const pending = response("READY");
    expect(describeQuickProcessing(pending, 30).checkNeeded).toBe(false);
    expect(describeQuickProcessing(pending, 1)).toMatchObject({
      label: "Checking availability",
      checkNeeded: false,
      message: null,
    });
    expect(describeQuickProcessing({ ...response("FAILED"), ready: true }, 30)).toEqual({
      label: "Ready",
      stageLabel: null,
      checkNeeded: false,
      message: "Processing complete. This video is ready to publish.",
    });
  });

  it("uses a known stage without claiming continuous progress or showing internal details", () => {
    const status = response();
    expect(describeQuickProcessing(status, 30).stageLabel).toBe("Preparing playback");
    status.processing!.stage = "__proto__";
    status.processing!.errorMessage = "private worker path or storage diagnostics";
    const unknownStage = describeQuickProcessing(status, 30);
    expect(unknownStage.stageLabel).toBeNull();
    expect(unknownStage.label).toBe("Processing");
    expect(JSON.stringify(unknownStage)).not.toMatch(/__proto__|private worker|20%/);
  });

  it("localizes pending, failed, cancelled and observed-stage feedback in Arabic", () => {
    for (const status of ["PROCESSING", "QUEUED", "FAILED", "CANCELLED", "READY"] as const) {
      const update = describeQuickProcessing(response(status), 30);
      for (const value of [update.label, update.message, update.stageLabel]) {
        if (value) {
          expect(uploadText(value, "en")).toBe(value);
          expect(uploadText(value, "ar")).toMatch(/[\u0600-\u06ff]/);
        }
      }
    }
  });
});
