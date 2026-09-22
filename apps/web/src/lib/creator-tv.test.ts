import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  selectCreatorTvMonetizedPlayback,
  type CreatorTvLinearCapability,
} from "./creator-tv";

const playerSource = readFileSync(
  new URL("../components/creator-tv/creator-tv-player.tsx", import.meta.url),
  "utf8",
);
const livePlayerSource = readFileSync(
  new URL("../components/player/live-ayin-player.tsx", import.meta.url),
  "utf8",
);
const contractSource = readFileSync(new URL("./creator-tv.ts", import.meta.url), "utf8");

describe("Creator TV playback contract", () => {
  it("preserves progressive MP4 with client-side IMA as the safe fallback", () => {
    expect(contractSource).toContain("exactMidProgramSynchronization: false");
    expect(contractSource).toContain('strategy: "BEST_EFFORT_PROGRESSIVE_MP4"');
    expect(playerSource).toContain("<AdEnabledAyinPlayer");
    expect(playerSource).toContain("initialPositionMs={progressiveOffsetMs}");
    expect(playerSource).toContain("progressEnabled={false}");
  });

  it("uses Google DAI only when the server reports a ready monetized stream", () => {
    const capability = linearCapability();
    expect(selectCreatorTvMonetizedPlayback(capability, false)).toEqual({
      mode: "GOOGLE_DAI_SSB",
      playbackUrl: "https://pubads.g.doubleclick.net/ssai/event/real-asset/master.m3u8",
      assetKey: "real-asset",
      providerResourceId: "resource-1",
    });
    expect(selectCreatorTvMonetizedPlayback(capability, true)).toEqual({
      mode: "CLIENT_IMA_MP4",
    });
    expect(
      selectCreatorTvMonetizedPlayback(
        {
          ...capability,
          monetization: {
            ...capability.monetization,
            dai: { ...capability.monetization.dai, available: false, playbackUrl: null },
          },
        },
        false,
      ),
    ).toEqual({ mode: "CLIENT_IMA_MP4" });
  });

  it("keeps DAI TV playback on the live player and falls back on fatal failure", () => {
    expect(playerSource).toContain("<LiveAyinPlayer");
    expect(playerSource).toContain("onFatal={handleDaiFatal}");
    expect(playerSource).toContain('"TV_SSAI_FALLBACK"');
    expect(livePlayerSource).toContain("<TvFocusScope");
    expect(livePlayerSource).toContain("onFatal?.(reason)");
  });
});

function linearCapability(): CreatorTvLinearCapability {
  return {
    provider: {
      providerKey: "owned-ffmpeg",
      configured: true,
      status: "READY",
      hlsUrl: "https://api.ayin.stream/public/linear/resource-1/index.m3u8",
      hlsMasterUrl: "https://api.ayin.stream/public/linear/resource-1/master.m3u8",
      providerResourceId: "resource-1",
    },
    hls: {
      available: true,
      url: "https://api.ayin.stream/public/linear/resource-1/index.m3u8",
      masterUrl: "https://api.ayin.stream/public/linear/resource-1/master.m3u8",
    },
    monetization: {
      signaling: {
        enabled: true,
        format: "HLS_CUE_OUT_IN",
        scte35Binary: false,
        emergencyKillSwitch: false,
        taskKillSwitch: false,
        reason: null,
      },
      dai: {
        provider: "GOOGLE_AD_MANAGER_DAI",
        integration: "SSB",
        configured: true,
        available: true,
        assetKey: "real-asset",
        playbackUrl: "https://pubads.g.doubleclick.net/ssai/event/real-asset/master.m3u8",
        contentSourceUrl: "https://api.ayin.stream/public/linear/resource-1/master.m3u8",
        reason: null,
      },
      clientSideImaFallback: true,
      opportunities: [],
    },
    fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
  };
}
