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
});
