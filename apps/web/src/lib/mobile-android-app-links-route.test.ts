import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/.well-known/assetlinks.json/route";

const variable = "ANDROID_APP_LINKS_SHA256_FINGERPRINTS";
const testFingerprint = Array.from({ length: 32 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
).join(":");

afterEach(() => vi.unstubAllEnvs());

describe("Android Digital Asset Links", () => {
  it.each([undefined, "   "])("does not claim domains without a fingerprint", async (setting) => {
    vi.stubEnv(variable, setting);
    const response = GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it.each([
    "REPLACE_WITH_FINAL_RELEASE_SHA256",
    JSON.stringify(["AB".repeat(32)]),
    JSON.stringify(["00:".repeat(31) + "00"]),
  ])("does not publish a malformed or placeholder fingerprint", async (setting) => {
    vi.stubEnv(variable, setting);
    const response = GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("serves exactly one mobile package association without redirect", async () => {
    vi.stubEnv(variable, JSON.stringify([testFingerprint, testFingerprint.toUpperCase()]));
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "net.ayin.app.mobile",
          sha256_cert_fingerprints: [testFingerprint.toUpperCase()],
        },
      },
    ]);
  });
});
