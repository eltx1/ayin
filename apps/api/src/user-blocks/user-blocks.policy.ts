import type { Prisma } from "@ayin/db";
import { ForbiddenException } from "@nestjs/common";

type BlockReader = Pick<Prisma.TransactionClient, "userBlock" | "channelMember" | "viewerProfile">;

export function blockedRelationWhere(accountId: string, others?: readonly string[]) {
  return {
    OR: [
      { blockerAccountId: accountId, ...(others ? { blockedAccountId: { in: [...others] } } : {}) },
      { blockedAccountId: accountId, ...(others ? { blockerAccountId: { in: [...others] } } : {}) },
    ],
  };
}

export async function blockedAccountIds(db: BlockReader, accountId?: string) {
  if (!accountId) return [];
  const rows = await db.userBlock.findMany({
    where: blockedRelationWhere(accountId),
    select: { blockerAccountId: true, blockedAccountId: true },
  });
  return [
    ...new Set(
      rows.map((row) =>
        row.blockerAccountId === accountId ? row.blockedAccountId : row.blockerAccountId,
      ),
    ),
  ];
}

export async function assertNoUserBlock(
  db: BlockReader,
  accountId: string,
  others: readonly string[],
) {
  if (!others.length) return;
  const block = await db.userBlock.findFirst({ where: blockedRelationWhere(accountId, others) });
  if (block)
    throw new ForbiddenException({
      error: {
        code: "USER_BLOCKED",
        message: "This interaction is unavailable because of a user block.",
      },
    });
}

export async function assertNoChannelBlock(
  db: BlockReader,
  accountId: string | undefined,
  channelId: string,
) {
  if (!accountId) return;
  const owners = await db.channelMember.findMany({
    where: { channelId, role: "OWNER" },
    select: { accountId: true },
  });
  await assertNoUserBlock(
    db,
    accountId,
    owners.map((owner) => owner.accountId),
  );
}

export async function assertNoProfileBlock(db: BlockReader, accountId: string, profileId: string) {
  const profile = await db.viewerProfile.findUnique({
    where: { id: profileId },
    select: { accountId: true },
  });
  if (profile) await assertNoUserBlock(db, accountId, [profile.accountId]);
}

export async function filterBlockedNotifications<T extends { data: Prisma.JsonValue }>(
  db: BlockReader & Pick<Prisma.TransactionClient, "video">,
  accountId: string,
  rows: T[],
) {
  const blocked = await blockedAccountIds(db, accountId);
  if (!blocked.length) return rows;
  const denied = new Set(blocked);
  const metadata = rows.map((row) => {
    const value = row.data;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  });
  const values = (field: string) =>
    metadata.flatMap((data) =>
      typeof data[field] === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data[field])
        ? [data[field]]
        : [],
    );
  const [channels, profiles, videos] = await Promise.all([
    db.channelMember.findMany({
      where: { channelId: { in: values("channelId") }, role: "OWNER", accountId: { in: blocked } },
      select: { channelId: true },
    }),
    db.viewerProfile.findMany({
      where: { id: { in: values("profileId") }, accountId: { in: blocked } },
      select: { id: true },
    }),
    db.video.findMany({
      where: {
        id: { in: values("videoId") },
        channel: { members: { some: { role: "OWNER", accountId: { in: blocked } } } },
      },
      select: { id: true },
    }),
  ]);
  const channelIds = new Set(channels.map((row) => row.channelId));
  const profileIds = new Set(profiles.map((row) => row.id));
  const videoIds = new Set(videos.map((row) => row.id));
  return rows.filter((_, index) => {
    const data = metadata[index]!;
    return (
      !(typeof data.actorAccountId === "string" && denied.has(data.actorAccountId)) &&
      !(typeof data.channelId === "string" && channelIds.has(data.channelId)) &&
      !(typeof data.profileId === "string" && profileIds.has(data.profileId)) &&
      !(typeof data.videoId === "string" && videoIds.has(data.videoId))
    );
  });
}
