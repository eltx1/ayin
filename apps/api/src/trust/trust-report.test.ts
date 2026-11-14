import { describe, expect, it, vi } from "vitest";
import { reportSchema } from "./trust.schemas.js";
import { TrustService } from "./trust.service.js";
const targetId = "c0000000-0000-4000-8000-000000000003",
  profileId = "d0000000-0000-4000-8000-000000000004",
  accountId = "a0000000-0000-4000-8000-000000000001";
describe("moderation report targets", () => {
  it.each(["videoId", "commentId", "channelId"])(
    "accepts exactly one %s and persists its real existing target",
    async (key) => {
      const lookup = vi.fn().mockResolvedValue({ id: targetId }),
        create = vi.fn().mockResolvedValue({ id: targetId });
      const db = {
        client: {
          viewerProfile: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: profileId }) },
          channel: { findUniqueOrThrow: lookup },
          video: { findUniqueOrThrow: lookup },
          comment: { findUniqueOrThrow: lookup },
          report: { create },
        },
      };
      const service = new TrustService(db as never, {} as never);
      await service.report(accountId, {
        [key]: targetId,
        reason: "HARASSMENT",
        details: "Concern",
      });
      expect(lookup).toHaveBeenCalledOnce();
      expect(lookup).toHaveBeenCalledWith({ where: { id: targetId } });
      expect(create).toHaveBeenCalledWith({
        data: {
          reporterProfileId: profileId,
          [key]: targetId,
          reason: "HARASSMENT",
          details: "Concern",
        },
      });
    },
  );
  it.each([
    {},
    { videoId: targetId, channelId: targetId },
    { commentId: targetId, channelId: targetId },
    { channelId: "bad" },
    { channelId: targetId, accountId },
  ])("rejects invalid or ambiguous targets", (target) => {
    expect(reportSchema.safeParse({ ...target, reason: "OTHER" }).success).toBe(false);
  });
  it("never creates a channel report for a missing channel", async () => {
    const create = vi.fn();
    const service = new TrustService(
      {
        client: {
          viewerProfile: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: profileId }) },
          channel: { findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("missing")) },
          report: { create },
        },
      } as never,
      {} as never,
    );
    await expect(
      service.report(accountId, { channelId: targetId, reason: "OTHER" }),
    ).rejects.toThrow("missing");
    expect(create).not.toHaveBeenCalled();
  });
});
