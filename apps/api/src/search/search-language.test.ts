import { describe, expect, it } from "vitest";

import {
  detectSearchLanguage,
  languageFromLocale,
  normalizeArabicForSearch,
  resolveSearchLanguage,
} from "./search-language.js";

describe("Task 65 search language selection", () => {
  it("detects Arabic and English scripts while keeping locale fallback extensible", () => {
    expect(detectSearchLanguage("رحلة إلى النجوم")).toBe("ar");
    expect(detectSearchLanguage("running across cities")).toBe("en");
    expect(detectSearchLanguage("2026")).toBe("und");
    expect(languageFromLocale("ar-EG")).toBe("ar");
    expect(languageFromLocale("en_US")).toBe("en");
    expect(languageFromLocale("fr-FR")).toBe("und");
  });

  it("lets query script lead while UI locale remains a secondary signal", () => {
    expect(resolveSearchLanguage("إبراهيم", "en-US")).toMatchObject({
      queryLanguage: "ar",
      uiLanguage: "en",
      preferredLanguage: "ar",
      textSearchConfiguration: "simple",
    });
    expect(resolveSearchLanguage("running", "ar-EG")).toMatchObject({
      queryLanguage: "en",
      uiLanguage: "ar",
      preferredLanguage: "en",
      textSearchConfiguration: "english",
    });
    expect(resolveSearchLanguage("2026", "ar-EG").preferredLanguage).toBe("ar");
  });

  it("normalizes common Arabic variants without destructive transliteration", () => {
    expect(normalizeArabicForSearch("إِبْرَاهِيم")).toBe("ابراهيم");
    expect(normalizeArabicForSearch("آفاق الـصحراء")).toBe("افاق الصحراء");
    expect(normalizeArabicForSearch("فتى")).toBe("فتي");
    expect(normalizeArabicForSearch("مدرسة")).toBe("مدرسة");
    expect(normalizeArabicForSearch("مؤتمر")).toBe("مؤتمر");
  });
});
