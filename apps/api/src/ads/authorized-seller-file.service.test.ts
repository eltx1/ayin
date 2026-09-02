import { describe, expect, it } from "vitest";

import { validateAuthorizedSellerText } from "./authorized-seller-file.service.js";

describe("validateAuthorizedSellerText", () => {
  it("accepts seller rows and IAB 1.1 directives", () => {
    const input = [
      "OWNERDOMAIN=ayin.stream",
      "MANAGERDOMAIN=manager.example, US",
      "INVENTORYPARTNERDOMAIN=partner.example",
      "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
      "exchange.example, seller-42, RESELLER",
    ].join("\n");

    expect(validateAuthorizedSellerText(input)).toBe(input);
  });

  it("allows comments and future variables without weakening seller row validation", () => {
    expect(
      validateAuthorizedSellerText("# managed in AYIN\nCONTACT=ads@example.org\nFUTUREFIELD=value"),
    ).toContain("FUTUREFIELD=value");
  });

  it("rejects placeholder records", () => {
    expect(() => validateAuthorizedSellerText("example.com, YOUR_PUBLISHER_ID, DIRECT")).toThrow(
      /placeholder/iu,
    );
  });

  it("rejects invalid seller relationships", () => {
    expect(() => validateAuthorizedSellerText("google.com, pub-123, PARTNER")).toThrow(
      /DIRECT or RESELLER/iu,
    );
  });

  it("rejects invalid manager geography", () => {
    expect(() => validateAuthorizedSellerText("MANAGERDOMAIN=manager.example, USA")).toThrow(
      /two-letter/iu,
    );
  });
});
