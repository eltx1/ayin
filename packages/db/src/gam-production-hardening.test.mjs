import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const apiGam = readFileSync(
  new URL("../../../apps/api/src/ads/gam-production.service.ts", import.meta.url),
  "utf8",
);
const videoAds = readFileSync(
  new URL("../../../apps/api/src/ads/video-ad.service.ts", import.meta.url),
  "utf8",
);
const consent = readFileSync(
  new URL("../../../apps/web/src/lib/advertising-consent.ts", import.meta.url),
  "utf8",
);
const gpt = readFileSync(
  new URL("../../../apps/web/src/lib/google-gpt-page-ad-service.ts", import.meta.url),
  "utf8",
);
const ima = readFileSync(
  new URL("../../../apps/web/src/lib/google-ima-video-ad-service.ts", import.meta.url),
  "utf8",
);
const pageSlot = readFileSync(
  new URL("../../../apps/web/src/components/ads/page-ad-slot.tsx", import.meta.url),
  "utf8",
);
const player = readFileSync(
  new URL("../../../apps/web/src/components/player/ayin-player.tsx", import.meta.url),
  "utf8",
);

describe("Task 68 GAM production hardening", () => {
  it("keeps Google requests free of AYIN session/profile identifiers", () => {
    expect(apiGam).not.toContain("ayin_session");
    expect(apiGam).not.toMatch(/profileId|accountId|watchHistory|rawIp|ipAddress/iu);
    expect(apiGam).not.toContain("cust_params");
  });

  it("does not hardcode a seller certification identifier", () => {
    expect(apiGam).not.toContain("f08c47fec0942fa0");
    expect(apiGam).toContain("google.com, ${config.publisherId}, ${config.adsTxtRelationship}");
  });

  it("defaults to a provider-neutral limited-ads boundary instead of faking a CMP", () => {
    expect(consent).toContain('mode: "LIMITED_ADS"');
    expect(consent).toContain('source: "SAFE_DEFAULT"');
    expect(consent).toContain("registerAdvertisingConsentProvider");
  });

  it("uses the official limited GPT path and keeps empty render results ambiguous", () => {
    expect(gpt).toContain("https://pagead2.googlesyndication.com/tag/js/gpt.js");
    expect(gpt).toContain("setPrivacySettings");
    expect(pageSlot).toContain("GPT_EMPTY_OR_NETWORK_FAILURE");
    expect(pageSlot).not.toContain("GPT_NO_FILL");
  });

  it("distinguishes documented IMA no-fill codes from technical failures", () => {
    expect(ima).toContain("code === 1009 || code === 303");
    expect(ima).toContain("IMA_NO_FILL_");
    expect(ima).toContain("IMA_TECHNICAL_");
  });

  it("keeps configured GAM preroll behind IMA while preserving HLS to MP4 playback fallback", () => {
    expect(videoAds).toContain('slot: "PRE_ROLL"');
    expect(videoAds).toContain('source = "GOOGLE_AD_MANAGER"');
    expect(player).toContain("adaptiveSourceUrl");
    expect(player).toContain("fallbackToMp4Ref");
    expect(player).toContain('useRef<"HLS" | "MP4">("MP4")');
  });
});
