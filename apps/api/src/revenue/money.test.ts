import { describe, expect, it } from "vitest";

import {
  applyRevenueShareMicros,
  formatMoneyMicros,
  parseMoneyMicros,
} from "./money.js";

describe("revenue money math", () => {
  it("round-trips six-decimal money without floating point", () => {
    expect(formatMoneyMicros(parseMoneyMicros("1234.567891"))).toBe("1234.567891");
  });

  it("applies creator revenue share in integer micros", () => {
    const gross = parseMoneyMicros("100.000001");
    expect(formatMoneyMicros(applyRevenueShareMicros(gross, 5500))).toBe("55.000001");
  });

  it("handles negative adjustment math symmetrically", () => {
    const gross = parseMoneyMicros("-10.000000");
    expect(formatMoneyMicros(applyRevenueShareMicros(gross, 5500))).toBe("-5.500000");
  });

  it("rejects more than six decimal places", () => {
    expect(() => parseMoneyMicros("1.0000001")).toThrow("INVALID_MONEY");
  });
});
