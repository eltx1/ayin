import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Admin trust fixture requires isolated local ayin_e2e");
const [command, payloadRaw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(payloadRaw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (command === "reset") {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Report", "ModerationCase", "ModerationAction", "TakedownRequest", "CreatorTrustState" CASCADE',
    );
    process.stdout.write(JSON.stringify({ ok: true }));
  } else {
    if (
      typeof payload.accountId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.accountId,
      )
    )
      throw Error("Invalid fixture account");
    const accountId = payload.accountId,
      membership = await prisma.channelMember.findFirstOrThrow({
        where: { accountId, role: "OWNER" },
      }),
      channelId = membership.channelId;
    if (command === "seed") {
      const now = Date.now(),
        at = (index) => new Date(now - (26 - index) * 60000);
      const video = await prisma.video.create({
        data: {
          channelId,
          slug: `trust-fixture-${randomUUID()}`,
          title: "Actual trust fixture video",
          description: "Trust queue read fixture",
          status: "DRAFT",
        },
      });
      const profile = await prisma.viewerProfile.findFirstOrThrow({ where: { accountId } });
      const cases = Array.from({ length: 26 }, (_, index) => ({
        id: randomUUID(),
        status: "OPEN",
        summary: `Actual case ${index}`,
        createdAt: at(index),
        updatedAt: at(index),
      }));
      await prisma.moderationCase.createMany({ data: cases });
      await prisma.report.createMany({
        data: cases.map((row, index) => ({
          id: randomUUID(),
          reporterProfileId: profile.id,
          moderationCaseId: row.id,
          videoId: video.id,
          channelId,
          reason: "COPYRIGHT",
          details: `Actual full report ${index} END`,
          status: "OPEN",
          createdAt: row.createdAt,
        })),
      });
      const actions = Array.from({ length: 26 }, (_, index) => ({
        id: randomUUID(),
        actorAccountId: accountId,
        targetAccountId: accountId,
        channelId,
        videoId: video.id,
        kind: "WARN",
        reason: `Actual moderation reason ${index}`,
        createdAt: at(index),
      }));
      await prisma.moderationAction.createMany({ data: actions });
      const appeals = actions.map((row, index) => ({
        id: randomUUID(),
        actionId: row.id,
        accountId,
        status: "OPEN",
        message: `Actual full appeal explanation ${index} END`,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }));
      await prisma.moderationAppeal.createMany({ data: appeals });
      const takedowns = cases.map((row, index) => ({
        id: randomUUID(),
        requesterId: accountId,
        videoId: video.id,
        status: "OPEN",
        claimantName: `Actual claimant ${index}`,
        contactEmail: `claim-${index}@e2e.ayin.test`,
        rightsBasis: "Actual submitted rights evidence",
        details: `Actual detailed takedown evidence ${index} END`,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }));
      await prisma.takedownRequest.createMany({ data: takedowns });
      await prisma.creatorTrustState.upsert({
        where: { channelId },
        update: { level: "STANDARD", strikeCount: 0, reviewRequired: false },
        create: { channelId, level: "STANDARD", strikeCount: 0, reviewRequired: false },
      });
      process.stdout.write(
        JSON.stringify({
          caseId: cases[0].id,
          appealId: appeals[0].id,
          takedownId: takedowns[0].id,
          channelId,
          rows: 26,
        }),
      );
    } else if (command === "evidence") {
      const kind = payload.kind,
        id = payload.id;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
        throw Error("Invalid evidence id");
      const row =
        kind === "cases"
          ? await prisma.moderationCase.findUniqueOrThrow({ where: { id } })
          : kind === "appeals"
            ? await prisma.moderationAppeal.findUniqueOrThrow({ where: { id } })
            : kind === "takedowns"
              ? await prisma.takedownRequest.findUniqueOrThrow({ where: { id } })
              : null;
      if (!row) throw Error("Invalid evidence kind");
      const count = await prisma.adminAuditLog.count({
        where: { entityId: id, actorAccountId: accountId },
      });
      process.stdout.write(
        JSON.stringify({ status: row.status, resolution: row.resolution, audits: count }),
      );
    } else throw Error("Unknown fixture command");
  }
} finally {
  await prisma.$disconnect();
}
