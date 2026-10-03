import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../database/database.service.js";
import type { MfaService } from "../auth/mfa.service.js";
import type { VideoPolicyService } from "../video-policy/video-policy.service.js";
import { CommentRateLimiter } from "./comment-rate-limiter.js";
import { CommentsService } from "./comments.service.js";
function setup(overrides: Record<string, unknown> = {}, allowed = true, kids = false) {
  const video = {
    id: "video",
    channelId: "channel",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    commentsEnabled: true,
    removedAt: null,
    channel: { status: "ACTIVE", removedAt: null },
    ...overrides,
  };
  const client = {
    video: { findUnique: vi.fn(async () => video), update: vi.fn(async () => video) },
    channelMember: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => null) },
    adminRoleAssignment: {
      findMany: vi.fn(
        async (): Promise<Array<{ role: "AD_MANAGER" | "CONTENT_MODERATOR" | "ADMIN" }>> => [],
      ),
    },
    comment: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "comment" })),
      findUnique: vi.fn(async () => ({ status: "PUBLISHED", videoId: "video", parent: null })),
    },
    viewerProfile: { findFirst: vi.fn(async () => ({ id: "profile", isKids: kids })) },
    channelHiddenProfile: { findUnique: vi.fn(async () => null) },
    platformSetting: { findMany: vi.fn(async () => []) },
    reaction: { upsert: vi.fn(async () => undefined), deleteMany: vi.fn(async () => undefined) },
    report: { create: vi.fn(async () => ({ id: "report" })) },
  };
  const policy = { decide: vi.fn(async () => ({ allowed })) };
  const mfa = { assertAdminMfa: vi.fn(async () => undefined) };
  const service = new CommentsService(
    { client } as unknown as DatabaseService,
    new CommentRateLimiter(),
    policy as unknown as VideoPolicyService,
    mfa as unknown as MfaService,
  );
  return { service, client, policy, mfa };
}
describe("Comments availability boundary", () => {
  it.each([
    { removedAt: new Date() },
    { channel: { status: "SUSPENDED", removedAt: null } },
    { channel: { status: "ACTIVE", removedAt: new Date() } },
    { visibility: "PRIVATE" },
    { status: "DRAFT" },
  ])("rejects unavailable videos before reading or creating comments", async (state) => {
    const h = setup(state);
    await expect(h.service.list("video")).rejects.toMatchObject({ statusCode: 404 });
    await expect(h.service.create("account", "video", "hello")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(h.client.comment.findMany).not.toHaveBeenCalled();
    expect(h.client.comment.create).not.toHaveBeenCalled();
  });
  it("applies trusted country context and denied policy to reads, writes and public interactions", async () => {
    const h = setup({}, false);
    await expect(h.service.list("video", 0, 30, "EG")).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      h.service.create("account", "video", "hello", undefined, undefined, "EG"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      h.service.setLike("account", "comment", true, undefined, "EG"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      h.service.report("account", "comment", "SPAM", undefined, undefined, "EG"),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.policy.decide).toHaveBeenCalledWith("video", { countryCode: "EG" });
    expect(h.client.reaction.upsert).not.toHaveBeenCalled();
    expect(h.client.report.create).not.toHaveBeenCalled();
  });
  it("preserves the existing unlisted-write and public-list distinction", async () => {
    const h = setup({ visibility: "UNLISTED" });
    await expect(h.service.list("video")).rejects.toMatchObject({ statusCode: 404 });
    await expect(h.service.create("account", "video", "hello")).resolves.toMatchObject({
      id: "comment",
    });
  });
  it("denies Kids profile creation, likes and reports at the server", async () => {
    const h = setup({}, true, true);
    await expect(h.service.create("account", "video", "hello")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(h.service.setLike("account", "comment", true)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(h.service.report("account", "comment", "SPAM")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(h.client.comment.create).not.toHaveBeenCalled();
    expect(h.client.reaction.upsert).not.toHaveBeenCalled();
    expect(h.client.report.create).not.toHaveBeenCalled();
  });
  it("does not treat advertising staff as cross-channel comment moderators", async () => {
    const h = setup();
    h.client.adminRoleAssignment.findMany.mockResolvedValue([{ role: "AD_MANAGER" }]);
    await expect(
      h.service.setVideoComments("account", "video", false, {
        accountId: "account",
        sessionId: "session",
        authVersion: 1,
        reauthAt: Math.floor(Date.now() / 1000),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(h.client.video.update).not.toHaveBeenCalled();
  });
  it("requires fresh verification for scoped staff moderation and retains channel-owner authority", async () => {
    const h = setup();
    h.client.adminRoleAssignment.findMany.mockResolvedValue([{ role: "CONTENT_MODERATOR" }]);
    const auth = { accountId: "account", sessionId: "session", authVersion: 1 };
    await expect(h.service.setVideoComments("account", "video", false, auth)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      h.service.setVideoComments("account", "video", false, {
        ...auth,
        reauthAt: Math.floor(Date.now() / 1000),
      }),
    ).resolves.toMatchObject({ commentsEnabled: false });
    h.client.channelMember.findFirst.mockResolvedValue({ id: "owner" });
    await expect(h.service.setVideoComments("account", "video", true)).resolves.toMatchObject({
      commentsEnabled: true,
    });
  });
  it("delegates privileged moderation to the existing account/version MFA boundary", async () => {
    const h = setup();
    h.client.adminRoleAssignment.findMany.mockResolvedValue([{ role: "ADMIN" }]);
    await h.service.setVideoComments("account", "video", false, {
      accountId: "account",
      sessionId: "session",
      authVersion: 1,
      mfaAt: 123,
      mfaVersion: 4,
      reauthAt: Math.floor(Date.now() / 1000),
    });
    expect(h.mfa.assertAdminMfa).toHaveBeenCalledWith("account", 123, 4);
  });
});
