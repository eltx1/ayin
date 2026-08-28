import { describe, expect, it } from "vitest";

import { titleFromFilename } from "./title-from-filename";

describe("titleFromFilename", () => {
  it("turns a normal MP4 filename into a clean editable title", () => {
    expect(titleFromFilename("My_trip.final-cut_v2.MP4")).toBe("My trip final cut v2");
  });

  it("provides a safe title when the filename contains only separators", () => {
    expect(titleFromFilename("---.mp4")).toBe("Untitled video");
  });
});
