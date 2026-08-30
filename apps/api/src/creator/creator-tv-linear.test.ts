import { describe, expect, it } from "vitest";

import {
  LinearProviderUnavailableError,
  UnconfiguredLinearStreamingProvider,
  type LinearChannelPlan,
} from "./creator-tv-linear.provider.js";
import { buildXmlTv } from "./creator-tv-linear.service.js";

const plan: LinearChannelPlan = {
  tvChannelId: "00000000-0000-4000-8000-000000000001",
  channelId: "00000000-0000-4000-8000-000000000002",
  channelHandle: "ayin-test",
  generatedAt: "2026-08-30T18:00:00.000Z",
  windowEndsAt: "2026-08-30T19:00:00.000Z",
  programs: [
    {
      occurrenceKey: "auto:1",
      videoId: "00000000-0000-4000-8000-000000000003",
      title: "A & B <Live>",
      startsAt: "2026-08-30T18:00:00.000Z",
      endsAt: "2026-08-30T18:30:00.000Z",
      playbackOffsetMs: 0,
      source: { objectKey: "channels/test/source.mp4", mimeType: "video/mp4" },
    },
  ],
  adMarkers: [
    {
      id: "break-1",
      occurrenceKey: "auto:1",
      offsetMs: 600000,
      source: "PROGRAMMATIC",
      signaling: "SCTE35_INTENT",
    },
  ],
  epg: { format: "XMLTV", xml: "" },
  fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
};

describe("Creator TV linear foundation", () => {
  it("renders an XMLTV guide with escaped metadata", () => {
    const xml = buildXmlTv(plan.tvChannelId, "AYIN & Test", plan.programs);
    expect(xml).toContain('generator-info-name="AYIN"');
    expect(xml).toContain("AYIN &amp; Test");
    expect(xml).toContain("A &amp; B &lt;Live&gt;");
    expect(xml).toContain("20260830180000 +0000");
  });

  it("does not fabricate HLS when no provider is configured", async () => {
    const provider = new UnconfiguredLinearStreamingProvider();
    const state = await provider.getState(plan.tvChannelId);
    expect(state.configured).toBe(false);
    expect(state.hlsUrl).toBeNull();
    expect(state.status).toBe("UNCONFIGURED");
    await expect(provider.provision(plan)).rejects.toBeInstanceOf(LinearProviderUnavailableError);
    await expect(provider.reconcile(plan)).rejects.toBeInstanceOf(LinearProviderUnavailableError);
  });

  it("keeps stop idempotent while unconfigured", async () => {
    const provider = new UnconfiguredLinearStreamingProvider();
    await expect(provider.stop(plan.tvChannelId)).resolves.toMatchObject({
      configured: false,
      status: "STOPPED",
      hlsUrl: null,
    });
  });
});
