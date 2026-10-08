import { describe, expect, it, vi } from "vitest";
import {
  requireDurableUploadSettlement,
  FiniteMultipartDurableUploadSettlement,
  readDurableUploadCapability,
  UnsupportedDurableUploadSettlement,
  type DurableUploadSettlementEvidence,
} from "./durable-upload-settlement.js";
import type { MediaStorageAdapter } from "./media-storage.adapter.js";

const now = new Date("2026-10-06T00:00:00Z");
function evidence(): DurableUploadSettlementEvidence {
  return {
    provider: "r2",
    version: "AYIN_DURABLE_UPLOAD_ADMISSION_V1",
    browserGrantSettlement: {
      conclusion: "NO_LATE_PUT_PART_COMPLETE_OR_ALLOCATION",
      proofReference: "synthetic:browser:v1",
    },
    serverWriteSettlement: {
      conclusion: "NO_LATE_SOURCE_OR_OUTPUT_WRITE",
      proofReference: "synthetic:server:v1",
    },
    verifiedAt: new Date(now.getTime() - 1000),
    validUntil: new Date(now.getTime() + 1000),
  };
}
const storage = {
  kind: "r2",
  available: true,
  verifyUploadCleanupSettlement: vi.fn(),
} as unknown as MediaStorageAdapter;
describe("durable upload settlement admission", () => {
  it("keeps all shipped providers unsupported without any provider observation", () => {
    expect(() =>
      requireDurableUploadSettlement(new UnsupportedDurableUploadSettlement(), storage, now),
    ).toThrowError(
      expect.objectContaining({ code: "UPLOAD_RECOVERY_UNSUPPORTED", statusCode: 503 }),
    );
    expect(storage.verifyUploadCleanupSettlement).not.toHaveBeenCalled();
  });
  it("accepts complete trusted synthetic DI evidence", () => {
    expect(() =>
      requireDurableUploadSettlement({ admissionEvidence: evidence }, storage, now),
    ).not.toThrow();
  });
  it.each([
    "missing-browser",
    "missing-server",
    "missing-verifier",
    "expired",
    "future",
    "provider",
    "empty-proof",
    "wrong-conclusion",
  ])("rejects %s evidence", (kind) => {
    const candidate = evidence();
    const adapter = { ...storage };
    if (kind === "missing-browser") Reflect.deleteProperty(candidate, "browserGrantSettlement");
    if (kind === "missing-server") Reflect.deleteProperty(candidate, "serverWriteSettlement");
    if (kind === "missing-verifier")
      Reflect.deleteProperty(adapter, "verifyUploadCleanupSettlement");
    if (kind === "expired") candidate.validUntil = now;
    if (kind === "future") candidate.verifiedAt = new Date(now.getTime() + 1);
    if (kind === "provider") candidate.provider = "development";
    if (kind === "empty-proof") candidate.serverWriteSettlement.proofReference = "";
    if (kind === "wrong-conclusion")
      Reflect.set(candidate.serverWriteSettlement, "conclusion", "OBJECT_ABSENT");
    expect(() =>
      requireDurableUploadSettlement({ admissionEvidence: () => candidate }, adapter, now),
    ).toThrowError(expect.objectContaining({ code: "UPLOAD_RECOVERY_UNSUPPORTED" }));
  });
});

describe("read-only durable upload capability", () => {
  it("returns only the bounded unsupported contract for the shipped provider", () => {
    expect(
      readDurableUploadCapability(new UnsupportedDurableUploadSettlement(), storage, now),
    ).toEqual({ protocolVersion: 1, supported: false, reason: "UNSUPPORTED" });
    expect(storage.verifyUploadCleanupSettlement).not.toHaveBeenCalled();
  });
  it("observes trusted evidence without caching authorization for later writes", () => {
    let current: DurableUploadSettlementEvidence | null = evidence();
    const provider = { admissionEvidence: () => current };
    expect(readDurableUploadCapability(provider, storage, now)).toEqual({
      protocolVersion: 1,
      supported: true,
      reason: null,
    });
    current = null;
    expect(readDurableUploadCapability(provider, storage, now)).toEqual({
      protocolVersion: 1,
      supported: false,
      reason: "UNSUPPORTED",
    });
    expect(() => requireDurableUploadSettlement(provider, storage, now)).toThrowError(
      expect.objectContaining({ code: "UPLOAD_RECOVERY_UNSUPPORTED" }),
    );
  });
  it("contains unavailable evidence diagnostics without provider calls or details", () => {
    const provider = {
      admissionEvidence: () => {
        throw new Error("private-provider-diagnostic");
      },
    };
    expect(readDurableUploadCapability(provider, storage, now)).toEqual({
      protocolVersion: 1,
      supported: false,
      reason: "UNSUPPORTED",
    });
    expect(storage.verifyUploadCleanupSettlement).not.toHaveBeenCalled();
  });
});

describe("finite multipart V2 admission", () => {
  const provider = new FiniteMultipartDurableUploadSettlement();
  const finiteStorage = { ...storage, observeUploadCompletion: vi.fn() };
  it("stays disabled unless the explicit switch is true", () => {
    expect(() => requireDurableUploadSettlement(provider, finiteStorage, now)).toThrowError(
      expect.objectContaining({ code: "UPLOAD_RECOVERY_UNSUPPORTED" }),
    );
    expect(readDurableUploadCapability(provider, finiteStorage, now, false).supported).toBe(false);
    expect(requireDurableUploadSettlement(provider, finiteStorage, now, true)).toBe(2);
    expect(readDurableUploadCapability(provider, finiteStorage, now, true).supported).toBe(true);
    expect(readDurableUploadCapability(provider, finiteStorage, now, false).supported).toBe(false);
  });
  it("does not fabricate V1 settlement or require an impossible provider no-future proof", () => {
    const adapter = { ...finiteStorage };
    Reflect.deleteProperty(adapter, "verifyUploadCleanupSettlement");
    expect(requireDurableUploadSettlement(provider, adapter, now, true)).toBe(2);
    expect(JSON.stringify(provider.admissionEvidence())).not.toMatch(/NO_FUTURE|NO_LATE/);
    expect(adapter.observeUploadCompletion).not.toHaveBeenCalled();
  });
  it.each(["development", "missing-observer", "unavailable", "wrong-policy"])(
    "rejects %s",
    (kind) => {
      const adapter = { ...finiteStorage };
      const evidence = provider.admissionEvidence();
      if (kind === "development") Reflect.set(adapter, "kind", "development");
      if (kind === "missing-observer") Reflect.deleteProperty(adapter, "observeUploadCompletion");
      if (kind === "unavailable") Reflect.set(adapter, "available", false);
      if (kind === "wrong-policy") Reflect.set(evidence, "uncertaintyPolicy", "DROP_UNKNOWN");
      expect(() =>
        requireDurableUploadSettlement({ admissionEvidence: () => evidence }, adapter, now, true),
      ).toThrowError(expect.objectContaining({ code: "UPLOAD_RECOVERY_UNSUPPORTED" }));
    },
  );
});
