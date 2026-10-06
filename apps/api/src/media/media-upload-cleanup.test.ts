import { describe, expect, it } from "vitest";
import type { MediaUploadSession } from "@ayin/db";
import {
  cleanupOperationKey,
  uploadCleanupJobData,
  uploadCleanupRetentionDays,
} from "./media-upload-cleanup.js";

const now = new Date("2026-10-05T00:00:00.000Z");
const session = {
  id: "session",
  channelId: "channel",
  objectKey: "channels/one/unique-source.mp4",
  revision: 4,
  sourceAssetId: null,
  mode: "MULTIPART",
  providerUploadId: null,
  cleanupRetainUntil: null,
} as MediaUploadSession;

describe("Durable upload cleanup contracts", () => {
  it("keeps lost allocation and object obligations for PREPARING without an upload ID or source FK", () => {
    const jobs = uploadCleanupJobData(session, "account", null, now);
    expect(jobs.map((job) => job.kind)).toEqual(["OBJECT", "ALLOCATION"]);
    expect(new Set(jobs.map((job) => job.operationKey)).size).toBe(2);
    expect(
      jobs.every((job) => job.uploadSessionId === session.id && job.target === session.objectKey),
    ).toBe(true);
  });
  it("has deterministic, non-null uniqueness with and without privacy adoption", () => {
    const first = uploadCleanupJobData(
      { ...session, providerUploadId: "remote-1" },
      "account",
      null,
      now,
    );
    const adopted = uploadCleanupJobData(
      { ...session, providerUploadId: "remote-1" },
      "account",
      "privacy",
      now,
    );
    expect(first.map((job) => job.operationKey)).toEqual(adopted.map((job) => job.operationKey));
    expect(first.map((job) => job.kind)).toEqual(["OBJECT", "ALLOCATION", "MULTIPART"]);
    expect(cleanupOperationKey("owner", "multipart", "remote-1")).not.toBe(
      cleanupOperationKey("owner", "multipart", "remote-2"),
    );
  });
  it("keeps single PUT cleanup even though no multipart address exists", () => {
    expect(
      uploadCleanupJobData({ ...session, mode: "SINGLE" }, "account", null, now).map(
        (job) => job.kind,
      ),
    ).toEqual(["OBJECT"]);
  });
  it("bounds configurable retention and rejects non-finite or fractional values", () => {
    expect(uploadCleanupRetentionDays("1")).toBe(1);
    expect(uploadCleanupRetentionDays("365")).toBe(365);
    for (const value of ["0", "366", "Infinity", "NaN", "1.5", ""])
      expect(uploadCleanupRetentionDays(value)).toBe(30);
  });
});
