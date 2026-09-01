import { describe, expect, it } from "vitest";

import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2SigV4 } from "./r2-sigv4.js";

describe("media storage configuration", () => {
  it("fails closed to the development adapter when R2 credentials are absent outside production", () => {
    const config = loadMediaStorageConfig({ APP_ENV: "test" } as NodeJS.ProcessEnv);

    expect(config.mode).toBe("development");
    expect(config.endpoint).toBeNull();
  });

  it("rejects production startup when R2 credentials are absent", () => {
    expect(() =>
      loadMediaStorageConfig({ APP_ENV: "production" } as NodeJS.ProcessEnv),
    ).toThrow(/R2 configuration is required in production/);
  });

  it("rejects partial R2 credentials", () => {
    expect(() =>
      loadMediaStorageConfig({ APP_ENV: "test", R2_ACCOUNT_ID: "account" } as NodeJS.ProcessEnv),
    ).toThrow(/R2 configuration is incomplete/);
  });

  it("creates short-lived operation-specific presigned URLs without exposing the secret", () => {
    const config = loadMediaStorageConfig({
      APP_ENV: "test",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET: "ayin-media",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "super-secret-r2-key",
      UPLOAD_SESSION_SECRET: "task-06-test-upload-session-secret-more-than-32-chars",
    } as NodeJS.ProcessEnv);
    const signer = new R2SigV4(config);
    const signed = signer.presign({
      method: "PUT",
      key: "channels/channel-id/media/asset-id/source.mp4",
      query: [
        ["partNumber", "2"],
        ["uploadId", "upload-id"],
      ],
      expiresInSeconds: 120,
      now: new Date("2026-08-28T12:00:00.000Z"),
    });
    const url = new URL(signed.url);

    expect(config.mode).toBe("r2");
    expect(url.host).toBe("account123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/ayin-media/channels/channel-id/media/asset-id/source.mp4");
    expect(url.searchParams.get("partNumber")).toBe("2");
    expect(url.searchParams.get("uploadId")).toBe("upload-id");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.url).not.toContain("super-secret-r2-key");
  });
});
