import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@ayin/db";
import { blockTargetSchema } from "./user-blocks.controller.js";
import {
  assertNoUserBlock,
  blockedAccountIds,
  blockedRelationWhere,
  filterBlockedNotifications,
} from "./user-blocks.policy.js";

describe("user safety block contracts", () => {
  const actor = "d254cbbc-9451-4c09-bc36-af750ef4dfd8";
  const other = "e8f729f1-0482-45c8-88b9-58d050967077";
  it("accepts one public target and rejects account IDs, mixed targets and unknown keys", () => {
    expect(blockTargetSchema.safeParse({ profileId: other }).success).toBe(true);
    expect(blockTargetSchema.safeParse({ channelId: other }).success).toBe(true);
    for (const value of [
      {},
      { accountId: other },
      { profileId: other, channelId: other },
      { profileId: other, extra: true },
      { channelId: "bad" },
    ]) {
      expect(blockTargetSchema.safeParse(value).success).toBe(false);
    }
  });
  it("checks either block direction and rejects interactions", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ blockerAccountId: other, blockedAccountId: actor });
    const db = { userBlock: { findFirst } } as unknown as Prisma.TransactionClient;
    await expect(assertNoUserBlock(db, actor, [other])).rejects.toMatchObject({ status: 403 });
    expect(findFirst).toHaveBeenCalledWith({ where: blockedRelationWhere(actor, [other]) });
  });
  it("deduplicates bilateral relations and makes no identity query for anonymous readers", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { blockerAccountId: actor, blockedAccountId: other },
      { blockerAccountId: other, blockedAccountId: actor },
    ]);
    const db = { userBlock: { findMany } } as unknown as Prisma.TransactionClient;
    expect(await blockedAccountIds(db)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(await blockedAccountIds(db, actor)).toEqual([other]);
  });
  it("filters queued sender notifications and ignores invalid metadata IDs before database UUID queries", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const db = {
      userBlock: {
        findMany: vi.fn().mockResolvedValue([{ blockerAccountId: actor, blockedAccountId: other }]),
      },
      channelMember: { findMany: query },
      viewerProfile: { findMany: query },
      video: { findMany: query },
    } as unknown as Prisma.TransactionClient;
    const rows = [
      { id: "blocked", data: { actorAccountId: other } },
      { id: "invalid", data: { profileId: "not-a-uuid" } },
      { id: "system", data: {} },
    ];
    expect((await filterBlockedNotifications(db, actor, rows)).map((row) => row.id)).toEqual([
      "invalid",
      "system",
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) }),
    );
  });
});
