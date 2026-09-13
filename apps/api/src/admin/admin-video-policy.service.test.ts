import { describe, expect, it, vi } from "vitest";

import { AdminVideoPolicyService } from "./admin-video-policy.service.js";

describe("AdminVideoPolicyService", () => {
  it("writes an override and an audit record in the same transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({ videoId: "video", disposition: "FORCE_ALLOW" });
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const tx = { videoPolicyOverride: { upsert } };
    const database = {
      client: {
        video: { findUnique: vi.fn().mockResolvedValue({ id: "video" }) },
        videoPolicyOverride: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const policy = { readPolicy: vi.fn() };
    const service = new AdminVideoPolicyService(database as never, policy as never, audit as never);
    await service.setOverride("admin", "video", {
      disposition: "FORCE_ALLOW",
      reason: "Rights team approved a temporary exception.",
      expiresAt: null,
    });
    expect(upsert).toHaveBeenCalled();
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "video_policy.override_set", entityId: "video" }),
    );
  });
});
