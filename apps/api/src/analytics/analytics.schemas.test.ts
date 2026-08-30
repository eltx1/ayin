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
