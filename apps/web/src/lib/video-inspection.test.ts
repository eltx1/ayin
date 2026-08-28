import { describe, expect, it } from "vitest";

import { isMp4File } from "./video-inspection";

describe("video upload inspection", () => {
  it("accepts MP4 MIME or extension without treating other video containers as MP4", () => {
    expect(isMp4File({ type: "video/mp4", name: "clip.bin" } as File)).toBe(true);
    expect(isMp4File({ type: "", name: "clip.MP4" } as File)).toBe(true);
    expect(isMp4File({ type: "video/quicktime", name: "clip.mov" } as File)).toBe(false);
  });
});
