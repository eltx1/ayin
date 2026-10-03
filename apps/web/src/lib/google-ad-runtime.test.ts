import { describe, expect, it } from "vitest";

import type { AdvertisingConsentSnapshot } from "./advertising-consent";
import { gptPrivacySettingsForConsent, gptScriptUrlForConsent } from "./google-gpt-page-ad-service";
import { applyGoogleImaConsent, classifyImaErrorCode } from "./google-ima-video-ad-service";

const limited: AdvertisingConsentSnapshot = {
  mode: "LIMITED_ADS",
  source: "SAFE_DEFAULT",
  providerManaged: false,
};
const nonPersonalized: AdvertisingConsentSnapshot = {
  mode: "NON_PERSONALIZED",
  source: "CMP",
  providerManaged: true,
};

describe("Google advertising runtime hardening", () => {
  it("never upgrades restrictions already present on a Google tag", () => {
    const personalized: AdvertisingConsentSnapshot = {
      mode: "PERSONALIZED",
      source: "CMP",
      providerManaged: true,
    };
    for (const consent of [personalized, nonPersonalized, limited]) {
      const url = new URL(
        applyGoogleImaConsent(
          "https://securepubads.g.doubleclick.net/gampad/ads?ltd=1&npa=1&tfua=1&tfcd=1&rdp=1&iu=%2F123%2Fvideo",
          consent,
        ),
      );
      for (const key of ["ltd", "npa", "tfua", "tfcd", "rdp"])
        expect(url.searchParams.get(key)).toBe("1");
      expect(url.searchParams.get("iu")).toBe("/123/video");
    }
  });

  it("uses Google's limited-ads GPT loader for the safe default", () => {
    expect(gptScriptUrlForConsent(limited)).toBe(
      "https://pagead2.googlesyndication.com/tag/js/gpt.js",
    );
    expect(gptPrivacySettingsForConsent(limited)).toEqual({ limitedAds: true });
  });

  it("uses standard GPT with a non-personalized privacy setting when supplied by a provider", () => {
    expect(gptScriptUrlForConsent(nonPersonalized)).toBe(
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    );
    expect(gptPrivacySettingsForConsent(nonPersonalized)).toEqual({ nonPersonalizedAds: true });
  });

  it("classifies only documented empty VAST responses as detectable no-fill", () => {
    expect(classifyImaErrorCode(1009)).toBe("IMA_NO_FILL_1009");
    expect(classifyImaErrorCode(303)).toBe("IMA_NO_FILL_303");
    expect(classifyImaErrorCode(301)).toBe("IMA_TECHNICAL_301");
    expect(classifyImaErrorCode(undefined)).toBe("IMA_TECHNICAL_UNKNOWN");
  });

  it("adds privacy parameters only to Google IMA ad tags", () => {
    const google = applyGoogleImaConsent(
      "https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fvideo",
      limited,
    );
    expect(new URL(google).searchParams.get("ltd")).toBe("1");

    const thirdParty = "https://ads.publisher.example/vast?campaign=7";
    expect(applyGoogleImaConsent(thirdParty, limited)).toBe(thirdParty);
  });
});
