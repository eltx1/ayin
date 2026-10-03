import { describe, expect, it } from "vitest";
import { parseStudioAnalytics, type CreatorAnalytics } from "./studio-analytics";
function fixture(): CreatorAnalytics {
  const breakdown = () => ({ available: false, coverage: 0, items: [] });
  return {
    periodDays: 28,
    dateRange: {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-29T00:00:00.000Z",
      timezone: "UTC",
    },
    refresh: "rollup",
    lastRollupCheck: null,
    freshnessNote: "Complete UTC days",
    views: 0,
    uniqueViewersApprox: 0,
    uniqueViewerMethod: "Pseudonymous sessions",
    watchTimeMs: 0,
    averageViewDurationMs: 0,
    completionRate: 0,
    subscribersGained: 0,
    subscribersTotal: 0,
    retention: { available: false, coverage: 0, buckets: [] },
    trafficSources: breakdown(),
    devices: breakdown(),
    geography: { ...breakdown(), note: "No edge telemetry" },
    topVideos: [],
    playbackQuality: {
      available: false,
      protocols: breakdown(),
      startup: { available: false, sampleCount: 0, averageMs: null },
      buffering: {
        events: 0,
        measuredDurationSamples: 0,
        totalDurationMs: 0,
        averageDurationMs: null,
        eventsPerView: 0,
      },
      hlsFatalEvents: 0,
      mp4FallbackEvents: 0,
      qualitySwitchEvents: 0,
    },
    advertising: {
      available: false,
      opportunities: null,
      fills: null,
      fillRate: null,
      note: "Unavailable",
    },
    cohorts: {
      minimumCohortSize: 20,
      identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS",
      privacyNote: "Threshold",
      audienceDaily: [],
      retention: [],
      subscriberRetention: [],
      subscriberTrackingStartedAt: null,
    },
  };
}
describe("creator analytics contract", () => {
  it("preserves actual zeros, unavailable nullable measurements and removes unexpected fields", () => {
    const parsed = parseStudioAnalytics({ ...fixture(), privateDiagnostics: "not displayed" }, 28);
    expect(parsed).toEqual(fixture());
    expect(parsed.advertising.fillRate).toBeNull();
    expect(parsed.playbackQuality.startup.averageMs).toBeNull();
  });
  it("keeps all exposed daily/cohort rows and optional mature milestone content-return metrics", () => {
    const source = fixture();
    const milestone = {
      retainedProfiles: 5,
      retentionRate: 0.25,
      sessions: 10,
      sessionsPerRetainedProfile: 2,
      watchTimeMs: 50_000,
      averageWatchTimeMsPerRetainedProfile: 10_000,
      contentReturnProfiles: 2,
      contentReturnRate: 0.1,
    };
    for (let index = 1; index <= 28; index++) {
      const date = new Date(Date.UTC(2026, 8, index)).toISOString();
      source.cohorts.audienceDaily.push({
        date,
        activeProfiles: 20,
        newProfiles: 5,
        returningProfiles: 15,
        returningRate: 0.75,
        sessions: 25,
        sessionsPerActiveProfile: 1.25,
        watchTimeMs: 100_000,
        contentReturnProfiles: 10,
        contentReturnRate: 0.5,
      });
      source.cohorts.retention.push({
        cohortDate: date,
        cohortSize: 20,
        d1: milestone,
        d7: null,
        d30: null,
      });
      const subscriberMilestone = { ...milestone };
      Reflect.deleteProperty(subscriberMilestone, "contentReturnProfiles");
      Reflect.deleteProperty(subscriberMilestone, "contentReturnRate");
      source.cohorts.subscriberRetention.push({
        cohortDate: date,
        cohortSize: 20,
        d1: subscriberMilestone,
        d7: null,
        d30: null,
      });
    }
    expect(parseStudioAnalytics(source, 28)).toEqual(source);
  });
  it("accepts measured zero fill and startup, including zero-count unavailable categories", () => {
    const source = fixture();
    source.advertising = {
      available: true,
      opportunities: 7,
      fills: 0,
      fillRate: 0,
      note: "Observed",
    };
    source.playbackQuality.startup = { available: true, sampleCount: 1, averageMs: 0 };
    source.devices.items = [{ value: "UNKNOWN", count: 0 }];
    expect(parseStudioAnalytics(source, 28)).toEqual(source);
  });
  it("rejects a wrong period, non UTC/calendar ranges and out of range or duplicate dates", () => {
    const source = fixture();
    expect(() => parseStudioAnalytics(source, 7)).toThrow();
    expect(() =>
      parseStudioAnalytics(
        { ...source, dateRange: { ...source.dateRange, timezone: "local" } },
        28,
      ),
    ).toThrow();
    expect(() =>
      parseStudioAnalytics(
        { ...source, dateRange: { ...source.dateRange, to: "2026-09-30T00:00:00.000Z" } },
        28,
      ),
    ).toThrow();
    source.cohorts.retention = [
      { cohortDate: source.dateRange.to, cohortSize: 20, d1: null, d7: null, d30: null },
    ];
    expect(() => parseStudioAnalytics(source, 28)).toThrow();
    const duplicate = {
      cohortDate: source.dateRange.from,
      cohortSize: 20,
      d1: null,
      d7: null,
      d30: null,
    };
    source.cohorts.retention = [duplicate, duplicate];
    expect(() => parseStudioAnalytics(source, 28)).toThrow();
  });
  it("fails closed on exposed cohorts below the privacy threshold and invalid milestones", () => {
    const source = fixture();
    const cohort = {
      cohortDate: source.dateRange.from,
      cohortSize: 19,
      d1: null,
      d7: null,
      d30: null,
    };
    source.cohorts.retention = [cohort];
    expect(() => parseStudioAnalytics(source, 28)).toThrow();
    cohort.cohortSize = 20;
    const invalid = {
      retainedProfiles: 21,
      retentionRate: 1,
      sessions: 21,
      sessionsPerRetainedProfile: 1,
      watchTimeMs: 0,
      averageWatchTimeMsPerRetainedProfile: 0,
    };
    source.cohorts.retention = [{ ...cohort, d1: invalid }];
    expect(() => parseStudioAnalytics(source, 28)).toThrow();
  });
  it("rejects fabricated unavailable values, missing fields, negative/unsafe counters and oversized arrays", () => {
    for (const mutate of [
      (source: CreatorAnalytics) => {
        source.advertising.fillRate = 0;
      },
      (source: CreatorAnalytics) => {
        source.playbackQuality.startup.averageMs = 0;
      },
      (source: CreatorAnalytics) => {
        source.views = -1;
      },
      (source: CreatorAnalytics) => {
        source.watchTimeMs = Number.MAX_SAFE_INTEGER + 1;
      },
      (source: CreatorAnalytics) => {
        source.completionRate = 1.1;
      },
      (source: CreatorAnalytics) => {
        source.devices.items = Array.from({ length: 13 }, (_, index) => ({
          value: String(index),
          count: 0,
        }));
      },
    ]) {
      const source = fixture();
      mutate(source);
      expect(() => parseStudioAnalytics(source, 28)).toThrow();
    }
    const missing = { ...fixture() };
    Reflect.deleteProperty(missing, "views");
    expect(() => parseStudioAnalytics(missing, 28)).toThrow();
  });
});
