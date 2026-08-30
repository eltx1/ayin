import { describe, expect, it, vi } from "vitest";
import { CommunityService } from "./community.service.js";
describe("CommunityService", () => {
  it("does not query public posts when the feature is disabled", async () => {
    const database = { client: { channel: { findFirst: vi.fn() } } };
    const settings = { get: vi.fn(async () => false) };
    const service = new CommunityService(
      database as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.channelPosts("channel")).rejects.toMatchObject({
      code: "COMMUNITY_DISABLED",
    });
    expect(database.client.channel.findFirst).not.toHaveBeenCalled();
  });
  it("requires at least two poll options", async () => {
    const database = {
      client: {
        channelMember: {
          findFirst: vi.fn(async () => ({ channel: { id: "channel", name: "Channel" } })),
        },
      },
    };
    const settings = { get: vi.fn(async () => true) };
    const service = new CommunityService(
      database as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.create("account", { type: "POLL", body: null, pollOptions: ["One"] }),
    ).rejects.toMatchObject({ code: "POLL_OPTIONS_REQUIRED" });
  });
  it("keeps a scheduled image post in draft until its object is validated", async () => {
    const create = vi.fn(async ({ data }: { data: { status: string } }) => data);
    const database = {
      client: {
        channelMember: {
          findFirst: vi.fn(async () => ({ channel: { id: "channel", name: "Channel" } })),
        },
        communityPost: { create },
      },
    };
    const service = new CommunityService(
      database as never,
      { get: vi.fn(async () => true) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.create("account", {
      type: "IMAGE",
      body: "A scheduled image",
      scheduledPublishAt: "2026-09-01T12:00:00.000Z",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }),
    );
  });
  it("does not detach media from an already published image post", async () => {
    const transaction = vi.fn();
    const service = new CommunityService(
      {
        client: {
          communityPost: {
            findFirst: vi.fn(async () => ({
              id: "post",
              channelId: "channel",
              type: "IMAGE",
              status: "PUBLISHED",
              imageAssetId: "asset",
              channel: { id: "channel", name: "Channel" },
              imageAsset: { id: "asset", status: "VALIDATED" },
              pollOptions: [],
            })),
          },
          $transaction: transaction,
        },
      } as never,
      {} as never,
      { available: true } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.authorizeImage("account", "post", { mimeType: "image/jpeg", sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: "PUBLISHED_IMAGE_IMMUTABLE", statusCode: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
