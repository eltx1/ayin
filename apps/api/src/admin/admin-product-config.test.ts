import { describe, expect, it } from "vitest";

import {
  createHomeRowSchema,
  defaultProductControls,
  homeRowPatchSchema,
  updateProductControlsSchema,
} from "./admin-product-config.js";

describe("admin product controls", () => {
  it("accepts the country-neutral default navigation contract", () => {
    const parsed = updateProductControlsSchema.safeParse({
      ...defaultProductControls,
      reason: "Initial product configuration",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects arbitrary external navigation links", () => {
    const parsed = updateProductControlsSchema.safeParse({
      ...defaultProductControls,
      navigation: [
        { key: "bad", label: "Bad", href: "https://example.com", enabled: true, featureFlag: null },
      ],
      reason: "Trying invalid navigation",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects arbitrary external announcement links", () => {
    const parsed = updateProductControlsSchema.safeParse({
      ...defaultProductControls,
      announcement: { enabled: true, text: "Update", href: "https://example.com" },
      reason: "Trying invalid announcement navigation",
    });
    expect(parsed.success).toBe(false);
  });

  it("matches the database home-row item limit", () => {
    expect(
      homeRowPatchSchema.safeParse({ maxItems: 40, reason: "Set maximum supported size" }).success,
    ).toBe(true);
    for (const maxItems of [0, 41, 100, 1.5]) {
      expect(homeRowPatchSchema.safeParse({ maxItems, reason: "Invalid row size" }).success).toBe(
        false,
      );
    }
  });

  it("requires an audit reason for home row mutations", () => {
    expect(homeRowPatchSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(
      homeRowPatchSchema.safeParse({ enabled: false, reason: "Temporarily disable this row" })
        .success,
    ).toBe(true);
  });

  it("bounds new sections and reserves automatic composition keys without changing existing rows", () => {
    const input = {
      requestId: "11111111-1111-4111-8111-111111111111",
      expectedRowsRevision: "a".repeat(64),
      key: "documentaries",
      title: "  وثائقيات  ",
      source: "RECENTLY_ADDED",
      reason: "Create a curated documentary section",
    };
    expect(createHomeRowSchema.parse(input)).toMatchObject({
      title: "وثائقيات",
      maxItems: 24,
      enabled: true,
      audience: "ALL",
      confirmManagedTransition: false,
    });
    for (const patch of [
      { key: "auto-recently-added" },
      { key: "../admin" },
      { key: "x".repeat(81) },
      { source: "ARBITRARY_QUERY" },
      { maxItems: 41 },
      { maxItems: 0 },
      { title: " " },
      { reason: "" },
      { expectedRowsRevision: "" },
      { requestId: "not-a-uuid" },
      { targetRegions: ["USA"] },
    ])
      expect(createHomeRowSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(
      createHomeRowSchema.parse({ ...input, targetRegions: ["gb", " FR "] }).targetRegions,
    ).toEqual(["GB", "FR"]);
  });
});
