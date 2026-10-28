import { describe, expect, it } from "vitest";
import { loadMediaStorageConfig, type MediaStorageConfig } from "./media-storage.config.js";
import { configuredUploadRecovery, requireUploadRecoveryScope } from "./media-upload-rollout.js";
const account = "11111111-1111-4111-8111-111111111111";
const channel = "22222222-2222-4222-8222-222222222222";
const config = () => ({
  ...loadMediaStorageConfig({ APP_ENV: "test" }),
  recoveryV2Enabled: true,
  recoveryAudience: "all" as const,
  recoverySourceMaxBytes: 128 * 1024 ** 2,
  recoveryMaxOutstandingSources: 8,
  recoveryOutputEnvelopeBytes: 512 * 1024 ** 2,
  recoveryDebtAccountBytes: 40.5 * 1024 ** 3,
  recoveryDebtChannelBytes: 40.5 * 1024 ** 3,
});
describe("explicit bounded creator rollout", () => {
  it("keeps missing canary configuration closed rather than promoting its audience", () => {
    const legacy: MediaStorageConfig = config();
    delete legacy.recoveryAudience;
    expect(configuredUploadRecovery(legacy)).toBeNull();
    expect(configuredUploadRecovery({ ...config(), recoveryAudience: "canary" })).toBeNull();
    expect(loadMediaStorageConfig({ APP_ENV: "test" }).recoveryAudience).toBe("canary");
  });
  it("admits distinct creator tuples only with the explicit switch and sufficient complete budgets", () => {
    expect(requireUploadRecoveryScope(config(), account, channel, 128 * 1024 ** 2)).toMatchObject({
      accountId: account,
      channelId: channel,
    });
    expect(requireUploadRecoveryScope(config(), channel, account, 17 * 1024 ** 2)).toMatchObject({
      accountId: channel,
      channelId: account,
    });
    for (const patch of [
      { recoveryV2Enabled: false },
      { recoverySourceMaxBytes: 0 },
      { recoverySourceMaxBytes: 128 * 1024 ** 2 + 1 },
      { recoverySourceMaxBytes: 5 * 1024 ** 3 + 1 },
      { recoveryMaxOutstandingSources: 0 },
      { recoveryMaxOutstandingSources: 9 },
      { recoveryOutputEnvelopeBytes: 0 },
      { recoveryDebtAccountBytes: 40 * 1024 ** 3 },
      { recoveryDebtChannelBytes: 0 },
    ])
      expect(() =>
        requireUploadRecoveryScope({ ...config(), ...patch }, account, channel, 1024),
      ).toThrow();
  });
  it("rejects malformed scope and oversize bodies before allocation", () => {
    expect(() => requireUploadRecoveryScope(config(), "*", channel)).toThrow();
    expect(() =>
      requireUploadRecoveryScope(config(), account, channel, 128 * 1024 ** 2 + 1),
    ).toThrowError(expect.objectContaining({ code: "VIDEO_TOO_LARGE" }));
  });
  it("admits 5 GiB only with complete finite source and lifetime-output debt budgets", () => {
    const sourceMaxBytes = 5 * 1024 ** 3;
    const outputEnvelopeBytes = 16 * 1024 ** 3;
    const required = (320 * 5 + 16) * 1024 ** 3;
    const large = {
      ...config(),
      recoverySourceMaxBytes: sourceMaxBytes,
      recoveryOutputEnvelopeBytes: outputEnvelopeBytes,
      recoveryDebtAccountBytes: required,
      recoveryDebtChannelBytes: required,
    };
    expect(configuredUploadRecovery(large)).toEqual({ sourceMaxBytes, outputEnvelopeBytes });
    expect(() => requireUploadRecoveryScope(large, account, channel, sourceMaxBytes)).not.toThrow();
    expect(() =>
      requireUploadRecoveryScope(large, account, channel, sourceMaxBytes + 1),
    ).toThrowError(expect.objectContaining({ code: "VIDEO_TOO_LARGE" }));
    expect(
      configuredUploadRecovery({ ...large, recoveryDebtAccountBytes: required - 1 }),
    ).toBeNull();
    expect(
      configuredUploadRecovery({ ...large, recoveryDebtChannelBytes: required - 1 }),
    ).toBeNull();
    expect(
      configuredUploadRecovery({ ...large, recoveryOutputEnvelopeBytes: outputEnvelopeBytes + 1 }),
    ).toBeNull();
  });
});
