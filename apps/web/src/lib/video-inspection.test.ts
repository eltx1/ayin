import { describe, expect, it } from "vitest";

import {
  detectVideoContainer,
  isSupportedVideoFile,
  videoMimeTypeForUpload,
} from "./video-inspection";

describe("video source detection", () => {
  it("recognizes common phone and camera containers", () => {
    expect(detectVideoContainer({ name: "camera.bin", type: "video/mp4" })).toBe("mp4");
    expect(detectVideoContainer({ name: "IMG_0763.MOV", type: "" })).toBe("mov");
    expect(detectVideoContainer({ name: "camera.MKV", type: "" })).toBe("mkv");
    expect(detectVideoContainer({ name: "clip.webm", type: "video/webm" })).toBe("webm");
    expect(detectVideoContainer({ name: "legacy.AVI", type: "" })).toBe("avi");
    expect(detectVideoContainer({ name: "CAM0001.MTS", type: "" })).toBe("m2ts");
    expect(detectVideoContainer({ name: "broadcast.mxf", type: "application/mxf" })).toBe("mxf");
  });

  it("normalizes MIME aliases and file extensions for upload", () => {
    expect(videoMimeTypeForUpload({ name: "movie.mkv", type: "" })).toBe("video/x-matroska");
    expect(videoMimeTypeForUpload({ name: "movie.avi", type: "video/avi" })).toBe(
      "video/x-msvideo",
    );
    expect(videoMimeTypeForUpload({ name: "camera.m2ts", type: "" })).toBe("video/mp2t");
    expect(videoMimeTypeForUpload({ name: "legacy.ogv", type: "application/ogg" })).toBe(
      "video/ogg",
    );
  });

  it("rejects unsupported source containers", () => {
    const source = { name: "archive.xyz", type: "application/octet-stream" };
    expect(detectVideoContainer(source)).toBeNull();
    expect(isSupportedVideoFile(source)).toBe(false);
    expect(() => videoMimeTypeForUpload(source)).toThrow(/not supported/u);
  });
});
