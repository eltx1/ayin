import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UploadRateLimiter,
  UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE,
  UPLOAD_RECOVERY_READS_PER_MINUTE,
} from "./upload-rate-limiter.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("bounded multipart authorization throughput", () => {
  it("rejects requests after the configured per-window limit", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a", 2);
    limiter.consume("account-a", 2);
    expect(() => limiter.consume("account-a", 2)).toThrowError("Too many upload requests");
  });

  it("isolates counters by account key", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a", 1);
    expect(() => limiter.consume("account-b", 1)).not.toThrow();
  });

  it("allows all 1,024 minimum-size parts without exhausting the separate control-command budget", () => {
    vi.stubEnv("APP_ENV", "production");
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const limiter = new UploadRateLimiter();
    for (let i = 0; i < UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE; i++)
      limiter.consume("recovery-authorize:owner", UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE);
    expect(() =>
      limiter.consume("recovery-authorize:owner", UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE),
    ).toThrowError(expect.objectContaining({ code: "UPLOAD_RATE_LIMITED" }));
    for (let i = 0; i < 12; i++) limiter.consume("recovery-command:owner");
    expect(() => limiter.consume("recovery-command:owner")).toThrowError(
      expect.objectContaining({ code: "UPLOAD_RATE_LIMITED" }),
    );
    expect(() =>
      limiter.consume("recovery-authorize:another", UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE),
    ).not.toThrow();
    for (const key of ["inspect:owner", "recovery-outcome:owner"]) {
      for (let i = 0; i < UPLOAD_RECOVERY_READS_PER_MINUTE; i++)
        limiter.consume(key, UPLOAD_RECOVERY_READS_PER_MINUTE);
      expect(() => limiter.consume(key, UPLOAD_RECOVERY_READS_PER_MINUTE)).toThrowError(
        expect.objectContaining({ code: "UPLOAD_RATE_LIMITED" }),
      );
    }
    clock.mockReturnValue(1_060_000);
    expect(() =>
      limiter.consume("recovery-authorize:owner", UPLOAD_PART_AUTHORIZATIONS_PER_MINUTE),
    ).not.toThrow();
  });
});
