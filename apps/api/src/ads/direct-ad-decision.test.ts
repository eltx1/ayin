import { describe, expect, it } from "vitest";

import { chooseDirectCampaign, type DirectCampaignCandidate } from "./direct-ad-decision.js";
import type { DirectDecisionContext } from "./direct-ad.schemas.js";

const now = new Date("2026-08-30T00:00:00.000Z");
const context: DirectDecisionContext = {
  placementKey: "home_top",
  sessionId: "session-1",
  device: "DESKTOP",
  country: "US",
  region: null,
  category: "sports",
  channelId: null,
  videoId: null,
};

function candidate(overrides: Partial<DirectCampaignCandidate> = {}): DirectCampaignCandidate {
  return {
    id: "a-campaign",
    priority: 100,
    status: "ACTIVE",
    startsAt: new Date("2026-08-29T00:00:00.000Z"),
    endsAt: new Date("2026-09-01T00:00:00.000Z"),
    impressionGoal: null,
    totalImpressions: 0,
    frequencyCap: 3,
    sessionImpressions: 0,
    pacing: "ASAP",
    targeting: {
      placementKeys: ["home_top"],
      countries: ["US"],
      regions: [],
      devices: ["DESKTOP"],
      categories: ["sports"],
      channelIds: [],
      videoIds: [],
    },
    ...overrides,
  };
}

describe("direct ad decision", () => {
  it("chooses the highest-priority eligible campaign deterministically", () => {
    const selected = chooseDirectCampaign(
      [candidate({ id: "low", priority: 10 }), candidate({ id: "high", priority: 500 })],
      context,
      now,
    );
    expect(selected?.id).toBe("high");
  });

  it("rejects campaigns outside their dates", () => {
    expect(
      chooseDirectCampaign(
        [candidate({ startsAt: new Date("2026-09-02T00:00:00.000Z") })],
        context,
        now,
      ),
    ).toBeNull();
  });

  it("enforces targeting and frequency caps", () => {
    expect(
      chooseDirectCampaign(
        [candidate({ targeting: { ...candidate().targeting, countries: ["CA"] } })],
        context,
        now,
      ),
    ).toBeNull();
    expect(chooseDirectCampaign([candidate({ sessionImpressions: 3 })], context, now)).toBeNull();
  });

  it("returns null when no campaign is eligible", () => {
    expect(chooseDirectCampaign([candidate({ status: "PAUSED" })], context, now)).toBeNull();
  });
});
