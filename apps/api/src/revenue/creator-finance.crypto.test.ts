import { afterEach, describe, expect, it } from "vitest";

import {
  decryptPayoutDestination,
  encryptPayoutDestination,
  maskPayoutDestination,
} from "./creator-finance.crypto.js";

const previousKey = process.env.PAYOUT_DATA_ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.PAYOUT_DATA_ENCRYPTION_KEY;
  else process.env.PAYOUT_DATA_ENCRYPTION_KEY = previousKey;
});

describe("creator payout destination security", () => {
  it("encrypts with authenticated encryption and decrypts only inside the internal boundary", () => {
    process.env.PAYOUT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const plaintext = "Bank account beneficiary reference 1234567890";
    const encrypted = encryptPayoutDestination(plaintext);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptPayoutDestination(encrypted)).toBe(plaintext);
  });

  it("fails closed when the encryption key is absent or invalid", () => {
    delete process.env.PAYOUT_DATA_ENCRYPTION_KEY;
    expect(() => encryptPayoutDestination("destination-1234")).toThrow(
      "PAYOUT_DATA_ENCRYPTION_KEY_NOT_CONFIGURED",
    );

    process.env.PAYOUT_DATA_ENCRYPTION_KEY = "not-a-32-byte-key";
    expect(() => encryptPayoutDestination("destination-1234")).toThrow(
      "PAYOUT_DATA_ENCRYPTION_KEY_INVALID",
    );
  });

  it("returns masked display values instead of payout destinations", () => {
    expect(maskPayoutDestination("creator@example.com")).toBe("cr•••••@example.com");
    expect(maskPayoutDestination("GB12 AYIN 1234 5678 9012 34")).toBe("•••• 1234");

    const freeForm = maskPayoutDestination("contact@example.com, account 00112233");
    expect(freeForm).toBe("•••• 2233");
    expect(freeForm).not.toContain("example.com");
    expect(freeForm).not.toContain("00112233");
  });
});
