import { describe, expect, it } from "vitest";

import { analyticsBatchSchema, analyticsEventSchema } from "./analytics.schemas.js";

const event = {
  clientEventId: "5f2d6f02-81d0-4a18-b04f-c92b4ebc1a40",
  schemaVersion: 1 as const,
  eventName: "VIDEO_PROGRESS" as const,
  occurredAt: "2026-08-30T00:00:00.000Z",
  sessionId: "session-1234567890abcdef",
  videoId: "bd32beee-d066-4eb8-8423-c64b936f5c43",
  durationDeltaMs: 15_000,
  positionMs: 45_000,
  source: "WEB" as const,
};

describe("analytics contracts", () => {
  it("accepts a versioned sampled progress event", () => {
    expect(analyticsEventSchema.parse(event)).toMatchObject({
      schemaVersion: 1,
      eventName: "VIDEO_PROGRESS",
      durationDeltaMs: 15_000,
    });
  });

  it.each(["VIDEO_QUALITY_SWITCH", "VIDEO_HLS_FATAL", "VIDEO_FALLBACK"] as const)(
    "accepts adaptive playback event %s without adding private identifiers",
    (eventName) => {
      const parsed = analyticsEventSchema.parse({
        ...event,
        clientEventId: "87846524-50de-4bf0-b047-c0a86ea57c04",
        eventName,
        durationDeltaMs: undefined,
        positionMs: undefined,
        metadata: { protocol: eventName === "VIDEO_FALLBACK" ? "MP4" : "HLS" },
      });
      expect(parsed.eventName).toBe(eventName);
      expect(parsed.metadata).toEqual({
        protocol: eventName === "VIDEO_FALLBACK" ? "MP4" : "HLS",
      });
    },
  );

  it.each([
    "LIVE_PLAY_START",
    "LIVE_STARTUP",
    "LIVE_REBUFFER",
    "LIVE_RECONNECT",
    "LIVE_FATAL_ERROR",
    "LIVE_DURATION",
    "LIVE_END",
  ] as const)("accepts live playback event %s", (eventName) => {
    const parsed = analyticsEventSchema.parse({
      ...event,
      clientEventId: crypto.randomUUID(),
      eventName,
      videoId: undefined,
      channelId: "00000000-0000-4000-8000-000000000010",
      positionMs: undefined,
      durationDeltaMs:
        eventName === "LIVE_STARTUP" ||
        eventName === "LIVE_REBUFFER" ||
        eventName === "LIVE_DURATION"
          ? 1_250
          : undefined,
      metadata: { liveStreamId: "00000000-0000-4000-8000-000000000011" },
    });
    expect(parsed.eventName).toBe(eventName);
  });

  it.each([
    "TV_SSAI_SELECTED",
    "TV_SSAI_FALLBACK",
    "TV_AD_BREAK_OPEN",
    "TV_AD_BREAK_CLOSE",
  ] as const)("accepts Task 76 opportunity event %s with reconciliation identifiers", (eventName) => {
    const parsed = analyticsEventSchema.parse({
      ...event,
      clientEventId: crypto.randomUUID(),
      eventName,
      channelId: "00000000-0000-4000-8000-000000000010",
      metadata: {
        opportunityId: "ayin-example",
        providerResourceId: "linear-resource",
        assetKey: "real-asset-key",
      },
    });
    expect(parsed.eventName).toBe(eventName);
    expect(parsed.metadata?.opportunityId).toBe("ayin-example");
  });

  it("rejects unbounded noisy progress deltas", () => {
    expect(() => analyticsEventSchema.parse({ ...event, durationDeltaMs: 3_600_001 })).toThrow();
  });

  it("caps ingestion batches at 100 events", () => {
    const events = Array.from({ length: 101 }, (_, index) => ({
      ...event,
      clientEventId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(analyticsBatchSchema.safeParse({ events }).success).toBe(false);
  });
});
