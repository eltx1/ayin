import { describe, expect, it, vi } from "vitest";

import { AdminVideoPolicyService } from "./admin-video-policy.service.js";

describe("AdminVideoPolicyService Kids classification", () => {
  it("writes Kids classification and audit metadata in one transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({
      videoId: "video",
      maturityLevel: "GENERAL",
      ageRestriction: "NONE",
      kidsEligible: true,
    });
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const tx = { videoPolicy: { upsert } };
    const database = {
      client: {
        video: { findUnique: vi.fn().mockResolvedValue({ id: "video" }) },
        videoPolicy: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const service = new AdminVideoPolicyService(
      database as never,
      { readPolicy: vi.fn() } as never,
      audit as never,
    );

    await service.setClassification("admin", "video", {
      maturityLevel: "GENERAL",
      ageRestriction: "NONE",
      kidsEligible: true,
      reason: "Reviewed for Kids catalog.",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          maturityLevel: "GENERAL",
          ageRestriction: "NONE",
          kidsEligible: true,
        }),
      }),
    );
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "video_policy.classification_set",
        entityId: "video",
        metadata: expect.objectContaining({ kidsEligible: true }),
      }),
    );
  });

  it("rejects contradictory Kids classification", async () => {
    const database = {
      client: { video: { findUnique: vi.fn().mockResolvedValue({ id: "video" }) } },
    };
    const service = new AdminVideoPolicyService(
      database as never,
      { readPolicy: vi.fn() } as never,
      { recordInTransaction: vi.fn() } as never,
    );

    await expect(
      service.setClassification("admin", "video", {
        maturityLevel: "MATURE",
        ageRestriction: "NONE",
        kidsEligible: true,
        reason: "Invalid attempt.",
      }),
    ).rejects.toThrow("Kids-eligible content must be GENERAL");
  });
});
