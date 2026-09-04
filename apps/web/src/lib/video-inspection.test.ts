import { describe, expect, it } from "vitest";

import {
  detectVideoContainer,
  isSupportedVideoFile,
  videoMimeTypeForUpload,
} from "./video-inspection";

describe("video source detection", () => {
  it("recognizes MP4 from MIME type or extension", () => {
    expect(detectVideoContainer({ name: "camera.bin", type: "video/mp4" })).toBe("mp4");
    expect(detectVideoContainer({ name: "upload.MP4", type: "" })).toBe("mp4");
  });

  it("recognizes iPhone QuickTime MOV from MIME type or extension", () => {
    expect(detectVideoContainer({ name: "camera.bin", type: "video/quicktime" })).toBe("mov");
    expect(detectVideoContainer({ name: "IMG_0763.MOV", type: "" })).toBe("mov");
  });

  it("rejects unsupported source containers", () => {
    const source = { name: "clip.webm", type: "video/webm" };
    expect(detectVideoContainer(source)).toBeNull();
    expect(isSupportedVideoFile(source)).toBe(false);
    expect(() => videoMimeTypeForUpload(source)).toThrow(/Unsupported video source/u);
  });

  it("preserves the correct upload MIME for each supported source", () => {
    expect(videoMimeTypeForUpload({ name: "movie.mp4", type: "video/mp4" })).toBe("video/mp4");
    expect(videoMimeTypeForUpload({ name: "IMG_0763.mov", type: "video/quicktime" })).toBe(
      "video/quicktime",
    );
  });
});
