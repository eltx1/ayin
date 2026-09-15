import { describe, expect, it } from "vitest";

import { resolveCatalogCopy } from "./catalog-localization.js";

describe("catalog localization fallback", () => {
  const localizations = [
    {
      locale: "ar",
      title: "عنوان عربي",
      synopsis: null,
      shortDescription: "وصف عربي قصير",
    },
    {
      locale: "en",
      title: "English localized title",
      synopsis: "English localized synopsis",
      shortDescription: "English short description",
    },
    {
      locale: "fr",
      title: "Titre français",
      synopsis: "Synopsis français",
      shortDescription: "Description française",
    },
  ];

  it("uses requested locale first and primary/original metadata field-by-field", () => {
    const resolved = resolveCatalogCopy(
      "ar",
      {
        title: "Primary title",
        synopsis: "Primary synopsis",
        shortDescription: "Primary short",
      },
      localizations,
    );

    expect(resolved.title).toBe("عنوان عربي");
    expect(resolved.synopsis).toBe("Primary synopsis");
    expect(resolved.shortDescription).toBe("وصف عربي قصير");
    expect(resolved.source).toEqual({
      title: "requested",
      synopsis: "primary",
      shortDescription: "requested",
    });
  });

  it("uses English only after requested and primary/original values are absent", () => {
    const resolved = resolveCatalogCopy(
      "de",
      { title: null, synopsis: null, shortDescription: null },
      localizations,
    );

    expect(resolved.title).toBe("English localized title");
    expect(resolved.synopsis).toBe("English localized synopsis");
    expect(resolved.shortDescription).toBe("English short description");
    expect(resolved.source.title).toBe("english");
  });

  it("keeps locale rows isolated and never leaks another non-English locale", () => {
    const resolved = resolveCatalogCopy(
      "de",
      { title: "Original", synopsis: null, shortDescription: null },
      localizations.filter((item) => item.locale !== "en"),
    );

    expect(resolved.title).toBe("Original");
    expect(resolved.synopsis).toBeNull();
    expect(resolved.shortDescription).toBeNull();
    expect(resolved.title).not.toBe("Titre français");
    expect(resolved.synopsis).not.toBe("Synopsis français");
  });

  it("normalizes locale keys while preserving one entity row per locale", () => {
    const resolved = resolveCatalogCopy("AR", { title: "Original" }, localizations);
    expect(resolved.locale).toBe("ar");
    expect(resolved.title).toBe("عنوان عربي");
    expect(resolved.availableLocales).toEqual(["ar", "en", "fr"]);
  });
});
