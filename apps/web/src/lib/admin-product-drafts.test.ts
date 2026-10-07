import { describe, expect, it } from "vitest";
import {
  appendTaxonomyItem,
  productControlsIssueMessage,
  updateTaxonomyLabel,
  validateProductControlsDraft,
} from "./admin-product-drafts";
import type { ProductControls } from "./admin-product";

const controls = (): ProductControls => ({
  navigation: [{ key: "home", label: "Home", href: "/", enabled: true, featureFlag: null }],
  hero: { entityType: null, entityId: null },
  taxonomy: [
    { key: "stories-original", label: "قصص، وثقافة", enabled: false },
    { key: "films", label: "Film, documentary", enabled: true },
  ],
  announcement: { enabled: false, text: "", href: null },
  deviceVisibility: { web: true, mobile: false, tv: true },
});

describe("lossless product control drafts", () => {
  it("retains saved keys, disabled rows, commas and Arabic labels while editing", () => {
    const original = controls().taxonomy;
    const empty = updateTaxonomyLabel(original, 0, "");
    expect(empty).toEqual([{ ...original[0], label: "" }, original[1]]);
    expect(empty[1]).toBe(original[1]);
    expect(original[0]!.label).toBe("قصص، وثقافة");
    expect(updateTaxonomyLabel(empty, 0, "  قصص عربية، ووثائقيات  ")).toEqual([
      { key: "stories-original", label: "  قصص عربية، ووثائقيات  ", enabled: false },
      original[1],
    ]);
    expect(validateProductControlsDraft({ ...controls(), taxonomy: empty })).toBe("taxonomyLabel");
  });

  it("adds a stable noncolliding key without deriving it from a label or truncating existing data", () => {
    const original = [
      { key: "category-1", label: "Already here", enabled: false },
      ...controls().taxonomy,
    ];
    const added = appendTaxonomyItem(original);
    expect(added.slice(0, 3)).toEqual(original);
    expect(added[3]).toEqual({ key: "category-2", label: "", enabled: true });
    expect(updateTaxonomyLabel(added, 3, "الفنون")[3]).toEqual({
      key: "category-2",
      label: "الفنون",
      enabled: true,
    });
    const full = Array.from({ length: 100 }, (_, index) => ({
      key: `c-${index}`,
      label: "فئة",
      enabled: index % 2 === 0,
    }));
    expect(appendTaxonomyItem(full)).toBe(full);
    expect(validateProductControlsDraft({ ...controls(), taxonomy: [...full, full[0]!] })).toBe(
      "taxonomyLimit",
    );
  });

  it("accepts multilingual labels and rejects duplicate/invalid keys without deleting rows", () => {
    expect(validateProductControlsDraft(controls())).toBeNull();
    for (const [key, issue] of [
      ["stories-original", "taxonomyDuplicate"],
      ["مفتاح", "taxonomyKey"],
    ] as const) {
      const draft = controls();
      draft.taxonomy[1]!.key = key;
      expect(validateProductControlsDraft(draft)).toBe(issue);
      expect(draft.taxonomy).toHaveLength(2);
      expect(draft.taxonomy[0]!.enabled).toBe(false);
    }
    const longLabel = controls();
    longLabel.taxonomy[0]!.label = "a".repeat(81);
    expect(validateProductControlsDraft(longLabel)).toBe("taxonomyLabel");
  });

  it.each([
    "//external.example",
    "/\\external.example",
    "https://external.example",
    " /tv",
    "/tv\n",
    "/" + "a".repeat(160),
  ])("does not advertise an invalid internal announcement destination: %s", (href) => {
    const draft = controls();
    draft.announcement.href = href;
    expect(validateProductControlsDraft(draft)).toBe("announcementHref");
  });

  it("requires visible announcement text without erasing hidden text or device choices", () => {
    const draft = controls();
    draft.announcement = { enabled: true, text: "  ", href: "/ar/tv?source=announcement" };
    expect(validateProductControlsDraft(draft)).toBe("announcementText");
    draft.announcement.text = "  أهلاً بالمشاهدين  ";
    expect(validateProductControlsDraft(draft)).toBeNull();
    expect(draft.announcement.text).toBe("  أهلاً بالمشاهدين  ");
    expect(draft.deviceVisibility).toEqual({ web: true, mobile: false, tv: true });
    expect(productControlsIssueMessage("announcementText", "ar")).toContain("أدخل نص الإعلان");
  });
});
