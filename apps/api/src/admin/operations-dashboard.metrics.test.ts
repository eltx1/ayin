import { describe, expect, it } from "vitest";

import {
  evaluateOperationsAlerts,
  formatUnitMicros,
  grossMarginEstimate,
  rateBps,
} from "./operations-dashboard.metrics.js";

describe("Task 87 operations dashboard metrics", () => {
  it("calculates bounded basis-point rates and unit costs", () => {
    expect(rateBps(2, 100)).toBe(200);
    expect(rateBps(1, 0)).toBe(0);
    expect(formatUnitMicros(30_000_000n, 10)).toBe("3.000000");
  });

  it("never exposes gross margin from estimates or incomplete inputs", () => {
    expect(
      grossMarginEstimate({
        mode: "MANUAL_ESTIMATE",
        costsComplete: true,
        costCurrency: "USD",
        revenueCurrency: "USD",
        finalizedGrossMicros: 100_000_000n,
        finalizedCreatorShareMicros: 60_000_000n,
        totalCostMicros: 10_000_000n,
        grossCoverageComplete: true,
      }),
    ).toMatchObject({ available: false, amount: null, rate: null });

    expect(
      grossMarginEstimate({
        mode: "MANUAL_ACTUAL",
        costsComplete: true,
        costCurrency: "USD",
        revenueCurrency: "USD",
        finalizedGrossMicros: 100_000_000n,
        finalizedCreatorShareMicros: 60_000_000n,
        totalCostMicros: 10_000_000n,
        grossCoverageComplete: true,
      }),
    ).toEqual({
      available: true,
      amount: "30.000000",
      rate: 0.3,
      reason: null,
    });
  });

  it("surfaces only evidence-backed dangerous trends", () => {
    const alerts = evaluateOperationsAlerts(
      {
        apiRequests: 100,
        apiP95Ms: 1_200,
        api5xxRateBps: 300,
        dbConnectionUtilizationBps: 8_500,
        mediaQueueAgeSeconds: 700,
        mediaProcessingEnabled: true,
        activeWorkerCount: 0,
        backupAvailable: true,
        backupStatus: "success",
        backupAgeHours: 40,
        syntheticAvailable: true,
        syntheticStatus: "failed",
      },
      {
        apiP95Ms: 1_000,
        api5xxRateBps: 200,
        dbConnectionUtilizationBps: 8_000,
        mediaQueueAgeSeconds: 600,
        backupAgeHours: 36,
      },
    );

    expect(alerts.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "API_P95_HIGH",
        "API_5XX_RATE_HIGH",
        "DB_CONNECTION_PRESSURE",
        "MEDIA_QUEUE_AGE_HIGH",
        "MEDIA_WORKERS_UNAVAILABLE",
        "BACKUP_STALE",
        "SYNTHETIC_MONITORING_FAILED",
      ]),
    );
  });

  it("treats unavailable external evidence as warnings instead of fabricating green status", () => {
    const alerts = evaluateOperationsAlerts(
      {
        apiRequests: 0,
        apiP95Ms: 0,
        api5xxRateBps: 0,
        dbConnectionUtilizationBps: null,
        mediaQueueAgeSeconds: 0,
        mediaProcessingEnabled: false,
        activeWorkerCount: 0,
        backupAvailable: false,
        backupStatus: null,
        backupAgeHours: null,
        syntheticAvailable: false,
        syntheticStatus: null,
      },
      {
        apiP95Ms: 1_000,
        api5xxRateBps: 200,
        dbConnectionUtilizationBps: 8_000,
        mediaQueueAgeSeconds: 600,
        backupAgeHours: 36,
      },
    );
    expect(alerts.map((item) => item.code)).toEqual([
      "BACKUP_STATUS_UNAVAILABLE",
      "SYNTHETIC_STATUS_EXTERNAL",
    ]);
  });
});
