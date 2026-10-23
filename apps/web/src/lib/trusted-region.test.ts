import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));

import { trustedApiRegionHeaders } from "./trusted-region";

const token = "controlled-region-test-token-more-than32";
const marker = { "x-ayin-edge-context": "server" };
const unknown = { ...marker, "x-ayin-edge-token": token };

beforeEach(() => {
  incoming.headers = new Headers({ "cf-ipcountry": "US" });
  vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", token);
  vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("server-only viewer country forwarding", () => {
  it.each([undefined, "", "false", "TRUE", "1"])(
    "keeps the viewer unknown with country trust setting %s",
    async (flag) => {
      vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", flag);
      expect(await trustedApiRegionHeaders()).toEqual(unknown);
    },
  );

  it.each([undefined, "", " "])(
    "marks a tokenless server hop without relaying a country or credential (%j)",
    async (value) => {
      vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", value);
      vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
      expect(await trustedApiRegionHeaders()).toEqual(marker);
    },
  );

  it.each([null, "", "XX", "T1", "ZZ", "US, GB", "US, US", "United States"])(
    "authenticates an unknown context instead of relaying invalid country %j",
    async (country) => {
      vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
      incoming.headers = new Headers(country === null ? {} : { "cf-ipcountry": country });
      expect(await trustedApiRegionHeaders()).toEqual(unknown);
    },
  );

  it("relays only normalized trusted country and its own runtime authentication", async () => {
    vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
    incoming.headers = new Headers({
      "cf-ipcountry": "gb",
      "x-ayin-edge-context": "attacker",
      "x-ayin-edge-country": "US",
      "x-ayin-edge-token": "attacker",
      cookie: "private-cookie",
      authorization: "private-authorization",
    });
    expect(await trustedApiRegionHeaders()).toEqual({
      ...unknown,
      "x-ayin-edge-country": "GB",
    });
  });
});
