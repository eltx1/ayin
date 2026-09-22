import { describe, expect, it } from "vitest";

import {
  LinearProviderUnavailableError,
  UnconfiguredLinearStreamingProvider,
  type LinearChannelPlan,
} from "./creator-tv-linear.provider.js";
import { buildXmlTv } from "./creator-tv-linear.service.js";
import {
  buildLinearMasterManifest,
  buildProgramFfmpegArgs,
  injectAdMarkersIntoManifest,
} from "./owned-linear-streaming.provider.js";

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
      opportunityId: "break-1",
      occurrenceKey: "auto:1",
      offsetMs: 600000,
      durationMs: 30000,
      source: "PROGRAMMATIC",
      signaling: "SCTE35_INTENT",
    },
  ],
  epg: { format: "XMLTV", xml: "" },
  adSignaling: { enabled: true, format: "HLS_CUE_OUT_IN", scte35Binary: false },
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

  it("builds live HLS output with wall-clock and discontinuity semantics", () => {
    const args = buildProgramFfmpegArgs({
      ffmpegInputPath: "/tmp/source.mp4",
      seekMs: 1_500,
      durationMs: 10_000,
      segmentDurationSeconds: 4,
      outputDirectory: "/tmp/linear",
    });
    const flags = args[args.indexOf("-hls_flags") + 1];
    expect(flags).toContain("append_list");
    expect(flags).toContain("program_date_time");
    expect(flags).toContain("discont_start");
    expect(flags).toContain("omit_endlist");
    expect(args).toContain("epoch_us");
  });

  it("publishes a conservative HLS v3 DAI master with required codec and resolution attributes", () => {
    const master = buildLinearMasterManifest();
    expect(master).toContain("#EXT-X-VERSION:3");
    expect(master).toContain('CODECS="avc1.640029,mp4a.40.2"');
    expect(master).toContain("RESOLUTION=1280x720");
    expect(master).toContain("AVERAGE-BANDWIDTH=4700000");
    expect(master).not.toContain("#EXT-X-INDEPENDENT-SEGMENTS");
  });

  it("translates intent to Google-supported HLS cue-out/cue-in without inventing SCTE-35", () => {
    const markedPlan: LinearChannelPlan = {
      ...plan,
      programs: [
        {
          ...plan.programs[0]!,
          startsAt: "2026-08-30T18:00:00.000Z",
          endsAt: "2026-08-30T18:30:00.000Z",
        },
      ],
      adMarkers: [
        {
          id: "break-1",
          opportunityId: "ayin-break-1",
          occurrenceKey: "auto:1",
          offsetMs: 2_000,
          durationMs: 4_000,
          source: "PROGRAMMATIC",
          signaling: "SCTE35_INTENT",
        },
      ],
    };
    const manifest = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T18:00:00.000Z",
      "#EXTINF:2.000,",
      "segment-1.ts",
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T18:00:02.000Z",
      "#EXTINF:2.000,",
      "segment-2.ts",
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T18:00:04.000Z",
      "#EXTINF:2.000,",
      "segment-3.ts",
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T18:00:06.000Z",
      "#EXTINF:2.000,",
      "segment-4.ts",
      "",
    ].join("\n");

    const rendered = injectAdMarkersIntoManifest(manifest, markedPlan);
    expect(rendered).toContain("#EXT-X-CUE-OUT:DURATION=4,BREAKID=ayin-break-1");
    expect(rendered).toContain("#EXT-X-CUE-IN");
    expect(rendered.indexOf("#EXT-X-CUE-OUT")).toBeLessThan(rendered.indexOf("segment-2.ts"));
    expect(rendered.indexOf("#EXT-X-CUE-IN")).toBeLessThan(rendered.indexOf("segment-4.ts"));
    expect(rendered).not.toContain("SCTE35-OUT");
    expect(rendered).not.toContain("SCTE35-IN");
    expect(rendered).not.toContain("EXT-OATCLS-SCTE35");
  });

  it("does not signal opportunities when Task 76 signaling is disabled", () => {
    const disabledPlan: LinearChannelPlan = {
      ...plan,
      adSignaling: { enabled: false, format: "NONE", scte35Binary: false },
    };
    const manifest = [
      "#EXTM3U",
      "#EXT-X-PROGRAM-DATE-TIME:2026-08-30T18:10:00.000Z",
      "#EXTINF:4.000,",
      "segment-1.ts",
      "",
    ].join("\n");
    expect(injectAdMarkersIntoManifest(manifest, disabledPlan)).toBe(manifest);
  });
});
