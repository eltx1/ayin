import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicies, configuredOrigin } from "./content-security-policy";
import { gptScriptUrlForConsent } from "./google-gpt-page-ad-service";

function sources(policy: string, directive: string) {
  return policy
    .split("; ")
    .find((part) => part.startsWith(`${directive} `))
    ?.split(" ")
    .slice(1);
}

describe("content security policy", () => {
  it("permits both real GPT loader origins, including limited ads", () => {
    const policy = buildContentSecurityPolicies({ NODE_ENV: "production" }).enforced;
    for (const mode of ["PERSONALIZED", "LIMITED_ADS"] as const) {
      const script = gptScriptUrlForConsent({ mode, source: "CMP", providerManaged: true });
      expect(sources(policy, "script-src")).toContain(new URL(script).origin);
    }
    expect(sources(policy, "script-src")).not.toContain("https:");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps the candidate opt-in and does not replace or relax the enforced policy", () => {
    const original = buildContentSecurityPolicies({});
    const candidate = buildContentSecurityPolicies({ AYIN_CSP_REPORT_ONLY: "true" });
    expect(original.reportOnly).toBeNull();
    expect(candidate.enforced).toBe(original.enforced);
    expect(candidate.reportOnly).toContain("script-src-attr 'none'");
    expect(candidate.reportOnly).not.toMatch(/report-uri|report-to|report-sample/);
  });

  it("limits candidate connections to reviewed origins, not any HTTPS/WebSocket host", () => {
    const result = buildContentSecurityPolicies({
      AYIN_CSP_REPORT_ONLY: "true",
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.test/v1",
      NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.example.test",
      AYIN_CSP_UPLOAD_ORIGIN: "https://test-bucket.account.r2.cloudflarestorage.com",
    });
    const connections = sources(result.reportOnly!, "connect-src");
    expect(connections).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://api.example.test",
        "https://media.example.test",
        "https://test-bucket.account.r2.cloudflarestorage.com",
      ]),
    );
    expect(connections).not.toContain("https:");
    expect(connections).not.toContain("wss:");
    expect(connections?.some((source) => source.includes("*"))).toBe(false);
  });

  it.each([
    "https://uploads.example.test/path",
    "https://uploads.example.test?signature=secret",
    "https://user:secret@uploads.example.test",
    "http://uploads.example.test",
    "https://*.example.test",
    "data:text/plain,not-an-origin",
  ])("rejects non-exact upload trust configuration: %s", (origin) => {
    expect(() =>
      buildContentSecurityPolicies({
        AYIN_CSP_REPORT_ONLY: "true",
        AYIN_CSP_UPLOAD_ORIGIN: origin,
      }),
    ).toThrow("AYIN_CSP_UPLOAD_ORIGIN");
  });

  it("normalizes configured HTTP origins but excludes credentials and opaque schemes", () => {
    expect(configuredOrigin("http://localhost:3001/api")).toBe("http://localhost:3001");
    expect(configuredOrigin("data:text/plain,test")).toBeNull();
    expect(configuredOrigin("https://user:secret@example.test")).toBeNull();
  });
});
