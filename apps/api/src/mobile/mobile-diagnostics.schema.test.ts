import { describe, expect, it, vi, afterEach } from "vitest";
import { mobileDiagnosticSchema } from "./mobile-diagnostics.schema.js";

const fixture = () => ({
  installationId: "11111111-1111-4111-8111-111111111111",
  platform: "android",
  appVersion: "1.1.0",
  bridgeVersion: 1,
  capabilities: ["privacy", "ads.gam", "ads.webview", "share", "media.pip", "upload.recovery"],
  configRevision: "a".repeat(64),
  configAppliedAt: "2026-11-14T12:00:00.000Z",
  lastConfigCheckAt: "2026-11-14T12:01:00.000Z",
  ads: { status: "NO_FILL", lastEvent: "ad_failed", errorCode: 3 },
  firebaseConfigured: true,
  runtimeAllowed: true,
  diagnosticsConsent: true,
});
afterEach(() => vi.useRealTimers());
describe("consented bounded mobile diagnostic snapshots", () => {
  it("preserves meaningful no-fill status and fixed SDK codes", () => {
    expect(mobileDiagnosticSchema.parse(fixture()).ads).toEqual({
      status: "NO_FILL",
      lastEvent: "ad_failed",
      errorCode: 3,
    });
  });
  it("rejects PII, secrets, arbitrary event parameters and unknown nested properties", () => {
    for (const extra of [
      { email: "person@example.com" },
      { token: "secret" },
      { url: "https://ayin.stream/watch/private" },
      { parameters: { search: "text" } },
    ]) {
      expect(mobileDiagnosticSchema.safeParse({ ...fixture(), ...extra }).success).toBe(false);
      expect(
        mobileDiagnosticSchema.safeParse({ ...fixture(), ads: { ...fixture().ads, ...extra } })
          .success,
      ).toBe(false);
    }
  });
  it("requires explicit true consent and does not coerce booleans, versions or SDK codes", () => {
    for (const change of [
      { diagnosticsConsent: false },
      { diagnosticsConsent: "true" },
      { firebaseConfigured: 1 },
      { runtimeAllowed: "true" },
      { appVersion: "latest" },
      { bridgeVersion: 2 },
      { ads: { ...fixture().ads, errorCode: "3" } },
    ])
      expect(mobileDiagnosticSchema.safeParse({ ...fixture(), ...change }).success).toBe(false);
  });
  it("bounds capability lists, status/event enums and fingerprint formats", () => {
    for (const change of [
      { capabilities: ["eval"] },
      { capabilities: ["privacy", "privacy"] },
      { configRevision: "https://example.com" },
      { ads: { ...fixture().ads, status: "email@example.com" } },
      { ads: { ...fixture().ads, lastEvent: "free text" } },
      { ads: { ...fixture().ads, errorCode: 10000 } },
    ])
      expect(mobileDiagnosticSchema.safeParse({ ...fixture(), ...change }).success).toBe(false);
  });
  it("allows absent config timestamps but rejects malformed and future client timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T12:01:00Z"));
    expect(
      mobileDiagnosticSchema.safeParse({
        ...fixture(),
        configAppliedAt: null,
        lastConfigCheckAt: null,
        configRevision: null,
      }).success,
    ).toBe(true);
    for (const value of ["not a date", "2026-11-14T12:07:00Z", "2026-99-99T00:00:00Z"])
      expect(
        mobileDiagnosticSchema.safeParse({ ...fixture(), lastConfigCheckAt: value }).success,
      ).toBe(false);
  });
});
