import { describe, expect, it } from "vitest";

import { selectEffectiveContract } from "./contract-selection.js";

const at = new Date("2026-08-30T00:00:00.000Z");

describe("selectEffectiveContract", () => {
  it("selects the latest active effective override", () => {
    const selected = selectEffectiveContract(
      [
        {
          id: "older",
          status: "ACTIVE" as const,
          revenueShareBps: 5000,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: null,
        },
        {
          id: "newer",
          status: "ACTIVE" as const,
          revenueShareBps: 6000,
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          effectiveTo: null,
        },
      ],
      at,
    );
    expect(selected?.id).toBe("newer");
  });

  it("ignores suspended, future and expired contracts", () => {
    expect(
      selectEffectiveContract(
        [
          {
            id: "suspended",
            status: "SUSPENDED" as const,
            revenueShareBps: 9000,
            effectiveFrom: null,
            effectiveTo: null,
          },
          {
            id: "future",
            status: "ACTIVE" as const,
            revenueShareBps: 9000,
            effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
            effectiveTo: null,
          },
          {
            id: "expired",
            status: "ACTIVE" as const,
            revenueShareBps: 9000,
            effectiveFrom: null,
            effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        at,
      ),
    ).toBeNull();
  });
});
