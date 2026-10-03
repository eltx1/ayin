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
      data: { accountId: payload.accountId, role: "CONTENT_MODERATOR" },
    });
    const group = randomUUID().slice(0, 8),
      query = "actual-video-" + group + "-";
    const channel = await prisma.channel.create({
      data: { name: "Actual video owner", handle: "native-video-owner-" + group },
    });
    const tv = await prisma.creatorTvChannel.create({
      data: {
        channelId: channel.id,
        name: "Actual selected TV",
        slug: "selected-tv-" + group,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const unrelated = await prisma.creatorTvChannel.create({
      data: {
        channelId: channel.id,
        name: "Other owner TV",
        slug: "other-tv-" + group,
        createdAt: new Date("2021-01-01T00:00:00Z"),
      },
    });
    const records = [];
    for (let n = 0; n < 26; n++)
      records.push(
        await prisma.video.create({
          data: {
            channelId: channel.id,
            title: query + (n === 0 ? "target" : n),
            slug: query + n,
            description: n === 0 ? "Actual private moderation description" : null,
            status: "PUBLISHED",
            visibility: "PRIVATE",
            videoForm: n === 0 ? "CLIP" : "LONG_FORM",
            commentsEnabled: true,
            publishedAt: new Date("2025-01-01T00:00:00Z"),
            updatedAt: new Date(Date.UTC(2035, 0, 1, 12, 0, 26 - n)),
          },
        }),
      );
    // An unrelated first stored preference must not control the selected destination.
    await prisma.creatorTvVideoPreference.create({
      data: {
        videoId: records[0].id,
        tvChannelId: unrelated.id,
        included: false,
        priority: -42,
        sortOrder: 7,
      },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    console.log(
      JSON.stringify({
        query,
        targetId: records[0].id,
        secondId: records[1].id,
        name: records[0].title,
        tvId: tv.id,
        unrelatedTvId: unrelated.id,
        sessions,
      }),
    );
  } else if (command === "change-role") {
    await prisma.adminRoleAssignment.updateMany({
      where: { accountId: payload.accountId, role: "CONTENT_MODERATOR" },
      data: { role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "finance") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "change-preference") {
    const current = await prisma.creatorTvVideoPreference.findUnique({
      where: { tvChannelId_videoId: { tvChannelId: payload.tvId, videoId: payload.targetId } },
    });
    const preference = await prisma.creatorTvVideoPreference.upsert({
      where: { tvChannelId_videoId: { tvChannelId: payload.tvId, videoId: payload.targetId } },
      create: {
        tvChannelId: payload.tvId,
        videoId: payload.targetId,
        included: false,
        updatedAt: new Date("2037-01-01T00:00:00Z"),
      },
      update: {
        included: false,
        updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1)),
      },
    });
    console.log(JSON.stringify({ preference }));
  } else if (command === "change-target") {
    const current = await prisma.video.findUniqueOrThrow({ where: { id: payload.targetId } });
    const target = await prisma.video.update({
      where: { id: current.id },
      data: {
        commentsEnabled: false,
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      },
    });
    console.log(JSON.stringify({ id: target.id, updatedAt: target.updatedAt }));
  } else if (command === "evidence") {
    const ids = [payload.targetId, payload.secondId].filter(Boolean);
    const targets = await prisma.video.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        visibility: true,
        commentsEnabled: true,
        updatedAt: true,
      },
    });
    const preferences = await prisma.creatorTvVideoPreference.findMany({
      where: { videoId: { in: ids } },
      orderBy: [{ videoId: "asc" }, { tvChannelId: "asc" }],
      select: {
        videoId: true,
        tvChannelId: true,
        included: true,
        priority: true,
        sortOrder: true,
        updatedAt: true,
      },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    const audits = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: payload.accountId,
        action: { in: ["video.admin_updated", "video.bulk_updated"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, entityId: true, reason: true, metadata: true },
    });
    console.log(JSON.stringify({ targets, preferences, sessions, audits }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
