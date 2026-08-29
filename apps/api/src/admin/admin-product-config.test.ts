import { describe, expect, it } from "vitest";

import {
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

  it("requires an audit reason for home row mutations", () => {
    expect(homeRowPatchSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(
      homeRowPatchSchema.safeParse({ enabled: false, reason: "Temporarily disable this row" })
        .success,
    ).toBe(true);
  });
});
