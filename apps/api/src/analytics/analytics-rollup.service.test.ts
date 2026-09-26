import { afterEach, describe, expect, it } from "vitest";

import {
  configuredAnalyticsRetentionDays,
  utcFloorDay,
  utcFloorHour,
} from "./analytics-rollup.service.js";

describe("analytics rollup UTC windows", () => {
  afterEach(() => {
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it("floors deterministic buckets in UTC regardless of offset in the input instant", () => {
    const instant = new Date("2026-09-26T23:47:12.345+03:00");
    expect(utcFloorHour(instant).toISOString()).toBe("2026-09-26T20:00:00.000Z");
    expect(utcFloorDay(instant).toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });

  it("clamps configured raw-event retention to the supported range", () => {
    process.env.ANALYTICS_RETENTION_DAYS = "10";
    expect(configuredAnalyticsRetentionDays()).toBe(30);
    process.env.ANALYTICS_RETENTION_DAYS = "730";
    expect(configuredAnalyticsRetentionDays()).toBe(730);
    process.env.ANALYTICS_RETENTION_DAYS = "99999";
    expect(configuredAnalyticsRetentionDays()).toBe(3650);
  });
});
