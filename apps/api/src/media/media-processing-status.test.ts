import { expect, it } from "vitest";
import {
  publicMediaProcessingCounts,
  publicMediaProcessingJob,
  publicMediaProcessingStatus,
} from "./media-processing-status.js";
it("projects integrity waiting into existing queued client contracts without counting it as active", () => {
  expect(publicMediaProcessingStatus("INTEGRITY_QUEUED")).toBe("QUEUED");
  expect(publicMediaProcessingJob({ status: "INTEGRITY_QUEUED", progressPercent: 0 })).toEqual({
    status: "QUEUED",
    progressPercent: 0,
  });
  expect(publicMediaProcessingCounts({ QUEUED: 3, INTEGRITY_QUEUED: 2, PROCESSING: 1 })).toEqual({
    QUEUED: 5,
    PROCESSING: 1,
  });
  expect(publicMediaProcessingJob(null)).toBeNull();
});
