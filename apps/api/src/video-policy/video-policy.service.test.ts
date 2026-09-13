import { describe, expect, it, vi } from "vitest";

import { VideoPolicyService, evaluatePolicy } from "./video-policy.service.js";

const basePolicy = {
  videoId: "11111111-1111-4111-8111-111111111111",
  maturityLevel: "GENERAL" as const,
  allowedTerritories: ["US", "EG"],
  blockedTerritories: ["GB"],
  rightsExpiresAt: null,
  ageRestriction: "NONE" as const,
};

describe("VideoPolicyService decisions", () => {
  it("allows an explicitly allowed standard territory", () => {
    expect(evaluatePolicy(basePolicy, null, { countryCode: "us" })).toMatchObject({
      allowed: true,
      reason: "AVAILABLE",
      countryCode: "US",
    });
  });

  it("blocks a blocked territory", () => {
    expect(
      evaluatePolicy({ ...basePolicy, allowedTerritories: [] }, null, { countryCode: "GB" }),
    ).toMatchObject({ allowed: false, reason: "REGION_BLOCKED" });
  });

  it("treats an unknown region conservatively when any geographic rule exists", () => {
    expect(evaluatePolicy(basePolicy, null, {})).toMatchObject({
      allowed: false,
      reason: "REGION_UNKNOWN",
    });
  });

  it("allows an active audited admin FORCE_ALLOW to override geo and expiry policy", () => {
    const expired = { ...basePolicy, rightsExpiresAt: new Date("2026-01-01T00:00:00.000Z") };
    expect(
      evaluatePolicy(
        expired,
        { videoId: basePolicy.videoId, disposition: "FORCE_ALLOW", expiresAt: null },
        { countryCode: "DE", now: new Date("2026-09-13T00:00:00.000Z") },
      ),
    ).toMatchObject({ allowed: true, reason: "ADMIN_FORCE_ALLOW" });
  });

  it("blocks an active admin FORCE_BLOCK", () => {
    expect(
      evaluatePolicy(
        null,
        { videoId: basePolicy.videoId, disposition: "FORCE_BLOCK", expiresAt: null },
        { countryCode: "US" },
      ),
    ).toMatchObject({ allowed: false, reason: "ADMIN_FORCE_BLOCK" });
  });

  it("uses maturity and age restriction as a kids-profile eligibility hook without claiming compliance", () => {
    expect(
      evaluatePolicy(
        { ...basePolicy, allowedTerritories: [], blockedTerritories: [], maturityLevel: "TEEN" },
        null,
        { isKidsProfile: true },
      ),
    ).toMatchObject({ allowed: false, reason: "KIDS_PROFILE_RESTRICTED" });
  });

  it("filters a batch consistently", async () => {
    const database = {
      client: {
        videoPolicy: { findMany: vi.fn().mockResolvedValue([basePolicy]) },
        videoPolicyOverride: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };
    const service = new VideoPolicyService(database as never);
    const allowed = await service.filterAvailableVideoIds([basePolicy.videoId], { countryCode: "EG" });
    expect(allowed.has(basePolicy.videoId)).toBe(true);
  });
});
