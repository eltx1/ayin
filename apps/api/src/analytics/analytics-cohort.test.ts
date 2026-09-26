import { afterEach, describe, expect, it } from "vitest";

import { cohortMilestone, configuredCohortMinSize } from "./analytics-cohort.js";

describe("cohort analytics privacy helpers", () => {
  afterEach(() => {
    delete process.env.ANALYTICS_COHORT_MIN_SIZE;
  });

  it("enforces a minimum privacy threshold and bounded configuration", () => {
    process.env.ANALYTICS_COHORT_MIN_SIZE = "2";
    expect(configuredCohortMinSize()).toBe(10);
    process.env.ANALYTICS_COHORT_MIN_SIZE = "35";
    expect(configuredCohortMinSize()).toBe(35);
    process.env.ANALYTICS_COHORT_MIN_SIZE = "5000";
    expect(configuredCohortMinSize()).toBe(1000);
  });

  it("uses the full cohort denominator and keeps immature milestones null", () => {
    expect(cohortMilestone(20, null, null, null)).toBeNull();
    expect(cohortMilestone(20, 5, 8, 10_000n, 4)).toEqual({
      retainedProfiles: 5,
      retentionRate: 0.25,
      sessions: 8,
      sessionsPerRetainedProfile: 1.6,
      watchTimeMs: 10_000,
      averageWatchTimeMsPerRetainedProfile: 2_000,
      contentReturnProfiles: 4,
      contentReturnRate: 0.2,
    });
  });
});
