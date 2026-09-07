import { describe, expect, it, vi } from "vitest";

import {
  autoThumbnailObjectKey,
  autoThumbnailSeekSeconds,
  MediaAutoThumbnailService,
} from "./media-auto-thumbnail.service.js";

describe("automatic video thumbnails", () => {
  it("uses a deterministic SEO thumbnail key", () => {
    expect(autoThumbnailObjectKey("channel-1", "video-1")).toBe(
      "channels/channel-1/videos/video-1/seo/auto-thumbnail.jpg",
    );
  });

  it("samples early in the video and caps the seek at three seconds", () => {
    expect(autoThumbnailSeekSeconds(null)).toBe(0);
    expect(autoThumbnailSeekSeconds(1_000)).toBeCloseTo(0.1);
    expect(autoThumbnailSeekSeconds(10_000)).toBeCloseTo(1);
    expect(autoThumbnailSeekSeconds(600_000)).toBe(3);
  });

  it.each(["PENDING", "UPLOADED", "VALIDATED"] as const)(
    "never generates over an existing %s creator thumbnail",
    async (status) => {
      const findUnique = vi.fn().mockResolvedValue({
        channelId: "channel-1",
        mediaAssets: [
          {
            id: "manual-thumb",
            status,
            r2ObjectKey: "channels/channel-1/media/manual/thumbnail.jpg",
          },
        ],
      });
      const uploadFile = vi.fn();
      const service = new MediaAutoThumbnailService(
        { client: { video: { findUnique } } } as never,
        { uploadFile } as never,
      );

      await expect(
        service.ensureForCanonical({
          videoId: "video-1",
          canonicalPath: "/tmp/canonical.mp4",
          durationMs: 60_000,
        }),
      ).resolves.toMatchObject({
        created: false,
        assetId: "manual-thumb",
        reason: "existing-thumbnail",
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            mediaAssets: expect.objectContaining({
              where: expect.objectContaining({
                status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
              }),
            }),
          }),
        }),
      );
      expect(uploadFile).not.toHaveBeenCalled();
    },
  );
});
