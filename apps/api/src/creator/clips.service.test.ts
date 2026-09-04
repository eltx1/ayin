import { describe, expect, it, vi } from "vitest";

import { ClipsService } from "./clips.service.js";

describe("ClipsService", () => {
  it("returns no catalog rows when the global Clips switch is disabled", async () => {
    const database = { client: { video: { findMany: vi.fn() } } };
    const settings = {
      get: vi.fn(async (key: string) => {
        if (key === "clipsEnabled") return false;
        if (key === "clipsAdFrequency") return 6;
        return true;
      }),
    };
    const service = new ClipsService(database as never, settings as never);
    const result = await service.feed({ take: 12 });
    expect(result.enabled).toBe(false);
    expect(database.client.video.findMany).not.toHaveBeenCalled();
  });

  it("queries only published public Clip rows with canonical playable sources", async () => {
    const findMany = vi.fn(async () => []);
    const database = { client: { video: { findMany } } };
    const settings = { get: vi.fn(async (key: string) => (key === "clipsAdFrequency" ? 6 : true)) };
    const service = new ClipsService(database as never, settings as never);
    await service.feed({ take: 10 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          videoForm: "CLIP",
          status: "PUBLISHED",
          visibility: "PUBLIC",
          mediaAssets: {
            some: expect.objectContaining({
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              mimeType: "video/mp4",
            }),
          },
        }),
        select: expect.objectContaining({
          mediaAssets: expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  kind: "SOURCE_VIDEO",
                  status: "VALIDATED",
                  mimeType: "video/mp4",
                }),
              ]),
            }),
          }),
        }),
      }),
    );
  });
});
