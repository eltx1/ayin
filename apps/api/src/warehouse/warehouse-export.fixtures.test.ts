import { describe, expect, it } from "vitest";

import { analyticsPseudonym } from "../analytics/analytics-identity.js";
import {
  adFactV1Schema,
  analyticsFactV1Schema,
  channelDimensionV1Schema,
  contentDimensionV1Schema,
  revenueFactV1Schema,
} from "./warehouse-export.schemas.js";
import {
  adFactFromSource,
  analyticsFactFromSource,
  channelDimensionFromSource,
  contentDimensionFromSource,
  revenueFactFromSource,
} from "./warehouse-export.service.js";

describe("Task 84 warehouse export fixtures", () => {
  it("exports analytics facts with existing pseudonyms and bounded coarse metadata only", () => {
    const fact = analyticsFactFromSource({
      id: "11111111-1111-4111-8111-111111111111",
      eventName: "VIDEO_START",
      occurredAt: new Date("2026-09-01T10:00:00.000Z"),
      receivedAt: new Date("2026-09-01T10:00:01.000Z"),
      sessionHash: "a".repeat(64),
      profileHash: "b".repeat(64),
      channelId: "22222222-2222-4222-8222-222222222222",
      videoId: "33333333-3333-4333-8333-333333333333",
      source: "WEB",
      deviceClass: "DESKTOP",
      durationDeltaMs: null,
      positionMs: null,
      metadata: {
        countryCode: "EG",
        trafficSource: "SEARCH",
        protocol: "HLS",
        rawQuery: "must-not-export",
        ip: "203.0.113.9",
      },
    });

    expect(analyticsFactV1Schema.parse(fact)).toEqual(fact);
    expect(fact).toMatchObject({
      schemaVersion: 1,
      countryCode: "EG",
      trafficSource: "SEARCH",
      protocol: "HLS",
    });
    expect(JSON.stringify(fact)).not.toContain("must-not-export");
    expect(JSON.stringify(fact)).not.toContain("203.0.113.9");
  });

  it("exports content and channel dimensions without titles, descriptions, names, or handles", () => {
    const content = contentDimensionFromSource({
      id: "33333333-3333-4333-8333-333333333333",
      channelId: "22222222-2222-4222-8222-222222222222",
      contentType: "CREATOR_VIDEO",
      videoForm: "LONG_FORM",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      durationMs: 120_000,
      scheduledPublishAt: null,
      publishedAt: new Date("2026-09-01T09:00:00.000Z"),
      removedAt: null,
      createdAt: new Date("2026-08-31T09:00:00.000Z"),
      updatedAt: new Date("2026-09-01T09:00:00.000Z"),
    });
    const channel = channelDimensionFromSource({
      id: "22222222-2222-4222-8222-222222222222",
      status: "ACTIVE",
      isPlatformOwned: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      removedAt: null,
    });

    expect(contentDimensionV1Schema.parse(content)).toEqual(content);
    expect(channelDimensionV1Schema.parse(channel)).toEqual(channel);
    expect(content).not.toHaveProperty("title");
    expect(content).not.toHaveProperty("description");
    expect(content).not.toHaveProperty("slug");
    expect(channel).not.toHaveProperty("name");
    expect(channel).not.toHaveProperty("handle");
    expect(channel).not.toHaveProperty("description");
  });

  it("pseudonymizes ad viewer/session identifiers and drops raw request metadata", () => {
    process.env.ANALYTICS_HASH_SALT = "task-84-fixture-hash-salt-more-than-32-characters";
    const fact = adFactFromSource({
      id: "44444444-4444-4444-8444-444444444444",
      placementId: "55555555-5555-4555-8555-555555555555",
      campaignId: null,
      creativeId: null,
      videoId: "33333333-3333-4333-8333-333333333333",
      profileId: "66666666-6666-4666-8666-666666666666",
      sessionId: "raw-ad-session-identifier",
      eventType: "IMPRESSION",
      revenue: { toString: () => "0.002500" },
      currency: "USD",
      occurredAt: new Date("2026-09-01T10:01:00.000Z"),
      createdAt: new Date("2026-09-01T10:01:01.000Z"),
    });

    expect(adFactV1Schema.parse(fact)).toEqual(fact);
    expect(fact.profileHash).toBe(analyticsPseudonym("66666666-6666-4666-8666-666666666666"));
    expect(fact.sessionHash).toBe(analyticsPseudonym("raw-ad-session-identifier"));
    expect(JSON.stringify(fact)).not.toContain("raw-ad-session-identifier");
    expect(fact).not.toHaveProperty("profileId");
    expect(fact).not.toHaveProperty("sessionId");
    expect(fact).not.toHaveProperty("requestId");
    expect(fact).not.toHaveProperty("metadata");
    delete process.env.ANALYTICS_HASH_SALT;
  });

  it("exports ledger revenue facts without memos, idempotency keys, payout destinations, or account data", () => {
    const fact = revenueFactFromSource({
      id: "77777777-7777-4777-8777-777777777777",
      channelId: "22222222-2222-4222-8222-222222222222",
      contractId: null,
      campaignId: null,
      videoId: "33333333-3333-4333-8333-333333333333",
      payoutId: null,
      type: "AD_REVENUE",
      state: "FINAL",
      grossAmount: "10.000000",
      amount: "7.000000",
      currency: "USD",
      revenueShareBps: 7000,
      adSource: "GAM",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-02T00:00:00.000Z"),
      occurredAt: new Date("2026-09-02T01:00:00.000Z"),
      finalizedAt: new Date("2026-09-02T02:00:00.000Z"),
      createdAt: new Date("2026-09-02T01:00:00.000Z"),
      updatedAt: new Date("2026-09-02T02:00:00.000Z"),
    });

    expect(revenueFactV1Schema.parse(fact)).toEqual(fact);
    expect(fact).not.toHaveProperty("memo");
    expect(fact).not.toHaveProperty("idempotencyKey");
    expect(fact).not.toHaveProperty("externalReference");
    expect(fact).not.toHaveProperty("legalName");
    expect(fact).not.toHaveProperty("accountId");
  });
});
