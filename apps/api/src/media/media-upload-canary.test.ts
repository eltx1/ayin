import { describe, expect, it } from "vitest";
import { configuredUploadCanary, requireUploadCanary } from "./media-upload-canary.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";
const account = "11111111-1111-4111-8111-111111111111";
const channel = "22222222-2222-4222-8222-222222222222";
const output = 1024 * 1024;
const source = 1024;
const budget = 5 * 1024 ** 3 + output;
const config = () => ({
  ...loadMediaStorageConfig({ APP_ENV: "test" }),
  recoveryV2Enabled: true,
  recoveryCanaryAccountId: account,
  recoveryCanaryChannelId: channel,
  recoveryCanarySourceMaxBytes: source,
  recoveryOutputEnvelopeBytes: output,
  recoveryDebtAccountBytes: budget,
  recoveryDebtChannelBytes: budget,
});
describe("bounded upload canary", () => {
  it("is unavailable without an exact tuple and positive bounded source/output limits", () => {
    expect(
      configuredUploadCanary(
        loadMediaStorageConfig({ APP_ENV: "test", AYIN_UPLOAD_RECOVERY_V2_ENABLED: "1" }),
      ),
    ).toBeNull();
    for (const name of [
      "recoveryCanaryAccountId",
      "recoveryCanaryChannelId",
      "recoveryCanarySourceMaxBytes",
      "recoveryOutputEnvelopeBytes",
    ] as const) {
      const value = config();
      Reflect.deleteProperty(value, name);
      expect(configuredUploadCanary(value)).toBeNull();
    }
  });
  it("requires enough capacity for source exposure AND its output envelope before advertising readiness", () => {
    expect(configuredUploadCanary(config())).toMatchObject({
      sourceMaxBytes: source,
      outputEnvelopeBytes: output,
    });
    expect(
      configuredUploadCanary({ ...config(), recoveryDebtAccountBytes: 5 * 1024 ** 3 }),
    ).toBeNull();
    expect(configuredUploadCanary({ ...config(), recoveryDebtChannelBytes: 1 })).toBeNull();
  });
  it("rejects unrelated accounts/channels, large sources, malformed tuples and disabled issuance", () => {
    expect(() => requireUploadCanary(config(), account, channel, source)).not.toThrow();
    for (const pair of [
      [channel, channel],
      [account, account],
    ])
      expect(() => requireUploadCanary(config(), pair[0]!, pair[1]!)).toThrow();
    expect(() => requireUploadCanary(config(), account, channel, source + 1)).toThrow();
    expect(() =>
      requireUploadCanary({ ...config(), recoveryV2Enabled: false }, account, channel),
    ).toThrow();
    expect(configuredUploadCanary({ ...config(), recoveryCanaryAccountId: "*" })).toBeNull();
    expect(
      configuredUploadCanary({ ...config(), recoveryCanarySourceMaxBytes: 16 * 1024 ** 2 + 1 }),
    ).toBeNull();
    expect(
      configuredUploadCanary({ ...config(), recoveryOutputEnvelopeBytes: 512 * 1024 ** 2 + 1 }),
    ).toBeNull();
  });
});
