import type { QuickProcessingStatus } from "./quick-upload";

const stageLabels = new Map([
  ["DOWNLOADING_SOURCE", "Preparing source"],
  ["VERIFYING_SOURCE_BYTES", "Checking source"],
  ["FFMPEG_TRANSCODING", "Preparing playback"],
  ["UPLOADING_CANONICAL", "Saving playback"],
  ["RECOVERING_FINAL_OBJECT", "Checking playback"],
  ["VERIFYING_R2_OBJECT", "Checking playback"],
  ["VERIFYING_CANONICAL_BYTES", "Checking playback"],
  ["GENERATING_AUTO_THUMBNAIL", "Preparing preview"],
  ["REMOVING_STAGING_SOURCE", "Finishing checks"],
]);

export function describeQuickProcessing(status: QuickProcessingStatus, reads: number) {
  // Playback readiness is authoritative; a job's READY state alone is insufficient.
  if (status.ready) {
    return {
      label: "Ready",
      stageLabel: null,
      checkNeeded: false,
      message: "Processing complete. This video is ready to publish.",
    };
  }

  const processing = status.processing;
  if (processing?.status === "FAILED" || processing?.status === "CANCELLED") {
    return {
      label: processing.status === "FAILED" ? "Failed" : "Cancelled",
      stageLabel: null,
      checkNeeded: true,
      message:
        processing.status === "FAILED"
          ? "Processing failed. Your video remains saved in Studio; review its status before publishing."
          : "Processing was cancelled. Your video remains saved in Studio; review its status before publishing.",
    };
  }

  const label = processing
    ? {
        INGESTING: "Preparing source",
        QUEUED: "Queued",
        PROCESSING: "Processing",
        UPLOADING: "Saving playback",
        VERIFYING: "Processing",
        READY: "Checking availability",
      }[processing.status]
    : "Waiting for status";
  return {
    label,
    stageLabel:
      processing && processing.status !== "QUEUED" && processing.status !== "READY"
        ? (stageLabels.get(processing.stage ?? "") ?? null)
        : null,
    checkNeeded: false,
    message:
      reads >= 30
        ? "Your video is still processing. You can keep this page open or return to Studio later."
        : null,
  };
}
