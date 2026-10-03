import { describe, expect, it, vi } from "vitest";

import type { AdvertisingConsentSnapshot } from "./advertising-consent";
import {
  gptPrivacySettingsForConsent,
  gptScriptUrlForConsent,
  mountGooglePublisherTagSlot,
} from "./google-gpt-page-ad-service";
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

it("uses the loaded GPT age enum and fails before requesting a slot if unavailable", () => {
  const child: AdvertisingConsentSnapshot = {
    mode: "PERSONALIZED",
    source: "APPLICATION",
    providerManaged: false,
    ageTreatment: "CHILD",
  };
  expect(gptPrivacySettingsForConsent(child, { CHILD: "actual-sdk-child" })).toEqual({
    nonPersonalizedAds: true,
    tagForAgeTreatment: "actual-sdk-child",
  });
  expect(() => gptPrivacySettingsForConsent(child)).toThrow("GPT_AGE_TREATMENT_API_UNAVAILABLE");
  expect(
    gptPrivacySettingsForConsent(
      { ...child, mode: "LIMITED_ADS", ageTreatment: "TEEN" },
      { TEEN: 42 },
    ),
  ).toEqual({ limitedAds: true, tagForAgeTreatment: 42 });
});
it("migrates restrictive IMA age flags without clearing stronger or duplicate server restrictions", () => {
  const personalized: AdvertisingConsentSnapshot = {
    mode: "PERSONALIZED",
    source: "CMP",
    providerManaged: true,
  };
  const base = "https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fvideo";
  for (const suffix of ["&tfat=1", "&tfat=2&tfat=1", "&tfcd=1", "&tfua=1&tfat=2"]) {
    const tag = new URL(
      applyGoogleImaConsent(base + suffix, { ...personalized, ageTreatment: "TEEN" }),
    );
    expect(tag.searchParams.getAll("tfat")).toEqual(["1"]);
    expect(tag.searchParams.get("npa")).toBe("1");
  }
  expect(
    new URL(applyGoogleImaConsent(base + "&tfat=2", personalized)).searchParams.get("tfat"),
  ).toBe("2");
  expect(
    new URL(
      applyGoogleImaConsent(base, { ...personalized, ageTreatment: "CHILD", mode: "LIMITED_ADS" }),
    ).searchParams.get("ltd"),
  ).toBe("1");
  const thirdParty = "https://ads.publisher.example/vast?tfat=2";
  expect(applyGoogleImaConsent(thirdParty, { ...personalized, ageTreatment: "CHILD" })).toBe(
    thirdParty,
  );
});

it("rejects a restricted actual mount before any GPT slot or delivery call if its SDK age API is missing", async () => {
  const defineSlot = vi.fn(),
    pubads = vi.fn(),
    display = vi.fn();
  vi.stubGlobal("window", {
    googletag: { defineSlot, pubads, display, cmd: { push: (callback: () => void) => callback() } },
  });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  try {
    await expect(
      mountGooglePublisherTagSlot({
        divId: "age-slot",
        adUnitPath: "/123/video",
        sizes: [[300, 250]],
        responsive: [],
        consent: {
          mode: "PERSONALIZED",
          source: "APPLICATION",
          providerManaged: false,
          ageTreatment: "CHILD",
        },
        onRender: vi.fn(),
      }),
    ).rejects.toThrow("GPT_AGE_TREATMENT_API_UNAVAILABLE");
    expect(defineSlot).not.toHaveBeenCalled();
    expect(pubads).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
