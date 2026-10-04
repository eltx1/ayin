import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(raw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (typeof payload.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.accountId))
    throw Error("Invalid actor");
  await prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } });
  if (command === "seed") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "OPERATIONS" },
    });
    const group = randomUUID().slice(0, 8),
      query = "actual-tv-" + group + "-";
    const channel = await prisma.channel.create({
      data: { name: "Actual TV owner", handle: "native-tv-owner-" + group },
    });
    const target = await prisma.creatorTvChannel.create({
      data: {
        channelId: channel.id,
        name: query + "target",
        slug: query + "target",
        updatedAt: new Date("2030-01-01T12:00:00Z"),
      },
    });
    await prisma.creatorTvChannel.createMany({
      data: Array.from({ length: 25 }, (_, n) => ({
        channelId: channel.id,
        name: query + n,
        slug: query + n,
        updatedAt: new Date(Date.UTC(2030, 0, 1, 11, 59 - n)),
      })),
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Actual scheduled film",
        slug: "native-tv-schedule-" + group,
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    await prisma.tvScheduleItem.createMany({
      data: Array.from({ length: 3 }, (_, n) => ({
        tvChannelId: target.id,
        videoId: video.id,
        startsAt: new Date(Date.now() + (n + 1) * 3600000),
        endsAt: new Date(Date.now() + (n + 2) * 3600000),
      })),
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    console.log(JSON.stringify({ query, targetId: target.id, name: target.name, sessions }));
  } else if (command === "change-target") {
    const current = await prisma.creatorTvChannel.findUniqueOrThrow({
      where: { id: payload.targetId },
    });
    const updated = await prisma.creatorTvChannel.update({
      where: { id: current.id },
      data: {
        status: "OFF_AIR",
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      },
    });
    console.log(
      JSON.stringify({ id: updated.id, updatedAt: updated.updatedAt, status: updated.status }),
    );
  } else if (command === "finance") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "change-role") {
    await prisma.adminRoleAssignment.updateMany({
      where: { accountId: payload.accountId, role: "OPERATIONS" },
      data: { role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "evidence") {
    const target = await prisma.creatorTvChannel.findUniqueOrThrow({
      where: { id: payload.targetId },
      select: { id: true, status: true, disabledAt: true, updatedAt: true },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    const audits = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: payload.accountId,
        entityType: "CreatorTvChannel",
        entityId: payload.targetId,
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, reason: true, metadata: true },
    });
    console.log(JSON.stringify({ target, sessions, audits }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
