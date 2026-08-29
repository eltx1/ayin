import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const playerSource = readFileSync(
  new URL("../components/creator-tv/creator-tv-player.tsx", import.meta.url),
  "utf8",
);
const contractSource = readFileSync(new URL("./creator-tv.ts", import.meta.url), "utf8");

describe("Creator TV V1 playback contract", () => {
  it("keeps exact mid-program synchronization explicitly unsupported in progressive MP4 V1", () => {
    expect(contractSource).toContain("exactMidProgramSynchronization: false");
    expect(contractSource).toContain('strategy: "BEST_EFFORT_PROGRESSIVE_MP4"');
    expect(playerSource).toContain("best-effort in V1");
  });
});
