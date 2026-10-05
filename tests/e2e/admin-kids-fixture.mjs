import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(raw),
  prisma = createPrismaClient(databaseUrl);
function fixtureIdentity(value) {
  if (
    !value ||
    typeof value.channelId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.channelId,
    ) ||
    typeof value.query !== "string" ||
    !/^kids-review-[0-9a-f]{8}$/.test(value.query)
  )
    throw Error("Expected an exact test-owned Kids fixture identity");
  return { channelId: value.channelId, query: value.query };
}
try {
  if (command !== "cleanup")
    await prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } });
  if (command === "cleanup") {
    if (!Array.isArray(payload.fixtures) || payload.fixtures.length > 20)
      throw Error("Expected a bounded list of exact test-owned fixtures");
    const fixtures = payload.fixtures.map(fixtureIdentity);
    await prisma.$transaction(async (transaction) => {
      for (const { channelId, query } of fixtures) {
        const channel = await transaction.channel.findUnique({ where: { id: channelId } });
        if (!channel) continue;
        if (channel.handle !== query) throw Error("Kids fixture identity does not match");
        await transaction.video.deleteMany({ where: { channelId } });
        await transaction.channel.delete({ where: { id: channelId } });
      }
    });
    const channelIds = fixtures.map((fixture) => fixture.channelId);
    console.log(
      JSON.stringify({
        remainingChannels: await prisma.channel.count({ where: { id: { in: channelIds } } }),
        remainingVideos: await prisma.video.count({ where: { channelId: { in: channelIds } } }),
      }),
    );
  } else if (command === "seed") {
    const { channelId, query } = fixtureIdentity(payload);
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: payload.role ?? "CONTENT_MODERATOR" },
    });
    const channel = await prisma.channel.create({
      data: { id: channelId, name: "Actual family channel قناة العائلة", handle: query },
    });
    const records = [];
    for (let n = 0; n < 27; n++)
      records.push(
        await prisma.video.create({
          data: {
            channelId: channel.id,
            title: query + " " + (n === 0 ? "Family story حكاية العائلة" : n),
            slug: query + "-" + n,
            status: n === 0 ? "DRAFT" : "PUBLISHED",
            visibility: n === 0 ? "PRIVATE" : "PUBLIC",
            updatedAt: new Date(Date.UTC(2035, 0, 1, 12, 0, 27 - n)),
          },
        }),
      );
    await prisma.videoPolicy.create({
      data: {
        videoId: records[0].id,
        maturityLevel: null,
        kidsEligible: false,
        allowedTerritories: ["CA"],
        blockedTerritories: ["US"],
        rightsExpiresAt: new Date("2038-01-01T00:00:00Z"),
      },
    });
    await prisma.videoPolicy.create({
      data: {
        videoId: records[1].id,
        maturityLevel: "TEEN",
        ageRestriction: "AGE_13_PLUS",
        kidsEligible: false,
      },
    });
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: records[0].id,
        actorAccountId: payload.accountId,
        disposition: "FORCE_BLOCK",
        reason: "Existing independent availability hold",
      },
    });
    console.log(
      JSON.stringify({
        channelId,
        query,
        targetId: records[0].id,
        secondId: records[1].id,
        title: records[0].title,
      }),
    );
  } else if (command === "remove-target") {
    await prisma.video.update({
      where: { id: payload.targetId },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    console.log(JSON.stringify({ ok: true }));
  } else if (command === "role") {
    await prisma.adminRoleAssignment.updateMany({
      where: { accountId: payload.accountId },
      data: { role: payload.role },
    });
    console.log(JSON.stringify({ ok: true }));
  } else if (command === "evidence") {
    const policy = await prisma.videoPolicy.findUnique({ where: { videoId: payload.targetId } });
    const override = await prisma.videoPolicyOverride.findUnique({
      where: { videoId: payload.targetId },
    });
    const audits = await prisma.adminAuditLog.findMany({
      where: { actorAccountId: payload.accountId, action: "video_policy.classification_set" },
      select: { action: true, entityId: true, reason: true, metadata: true },
    });
    console.log(JSON.stringify({ policy, override, audits }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
