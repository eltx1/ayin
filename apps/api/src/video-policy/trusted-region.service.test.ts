import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrustedRegionService, type HeaderBag } from "./trusted-region.service.js";

const token = "controlled-region-test-token-more-than32";
const service = new TrustedRegionService();

beforeEach(() => {
  vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "false");
  vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", token);
});
afterEach(() => vi.unstubAllEnvs());

describe("trusted viewer country", () => {
  it.each([undefined, "", "false", "TRUE", "1"])(
    "does not trust Cloudflare country with setting %s",
    (flag) => {
      vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", flag);
      expect(service.countryFromHeaders({ "cf-ipcountry": "US" })).toBeUndefined();
    },
  );

  it("accepts a direct trusted Cloudflare country only after explicit opt-in", () => {
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
    expect(service.countryFromHeaders({ "cf-ipcountry": "gb" })).toBe("GB");
  });

  it.each(
    [undefined, "", "XX", "T1", "ZZ", "US, GB", ["US"], ["US", "GB"]].map((country) => ({
      country,
    })),
  )("rejects an unknown or ambiguous direct country $country", ({ country }) => {
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
    expect(service.countryFromHeaders({ "cf-ipcountry": country })).toBeUndefined();
  });

  it.each(["false", "true"])(
    "uses authenticated viewer country instead of the SSR egress country with trust %s",
    (flag) => {
      vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", flag);
      expect(
        service.countryFromHeaders({
          "cf-ipcountry": "US",
          "x-ayin-edge-context": "server",
          "x-ayin-edge-token": token,
          "x-ayin-edge-country": "gb",
        }),
      ).toBe("GB");
    },
  );

  const invalidContexts: HeaderBag[] = [
    { "x-ayin-edge-context": "server" },
    { "x-ayin-edge-context": "" },
    { "x-ayin-edge-context": undefined },
    { "x-ayin-edge-country": "GB" },
    { "x-ayin-edge-country": "" },
    { "x-ayin-edge-country": undefined },
    { "x-ayin-edge-token": undefined },
    { "x-ayin-edge-token": "" },
    { "x-ayin-edge-token": "wrong", "x-ayin-edge-country": "GB" },
    { "x-ayin-edge-token": [token], "x-ayin-edge-country": "GB" },
    { "x-ayin-edge-token": [token, token], "x-ayin-edge-country": "GB" },
    { "x-ayin-edge-token": token + ", " + token, "x-ayin-edge-country": "GB" },
    { "x-ayin-edge-token": token },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": "" },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": "XX" },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": "T1" },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": "ZZ" },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": ["GB"] },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": ["GB", "US"] },
    { "x-ayin-edge-token": token, "x-ayin-edge-country": "GB, US" },
    {
      "x-ayin-edge-context": ["server"],
      "x-ayin-edge-token": token,
      "x-ayin-edge-country": "GB",
    },
    {
      "x-ayin-edge-context": "server, server",
      "x-ayin-edge-token": token,
      "x-ayin-edge-country": "GB",
    },
    {
      "x-ayin-edge-context": "unexpected",
      "x-ayin-edge-token": token,
      "x-ayin-edge-country": "GB",
    },
  ];
  it.each(invalidContexts)("never falls back from partial/invalid server context %j", (context) => {
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
    expect(service.countryFromHeaders({ "cf-ipcountry": "US", ...context })).toBeUndefined();
  });

  it("fails closed when the API token is missing despite supplied internal context", () => {
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
    vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", undefined);
    expect(
      service.countryFromHeaders({
        "cf-ipcountry": "US",
        "x-ayin-edge-token": token,
        "x-ayin-edge-country": "GB",
      }),
    ).toBeUndefined();
  });

  it("retains authenticated internal callers that predate the optional server marker", () => {
    expect(
      service.countryFromHeaders({ "x-ayin-edge-token": token, "x-ayin-edge-country": "US" }),
    ).toBe("US");
  });
});
