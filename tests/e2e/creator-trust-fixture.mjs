import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Trust fixture requires isolated local ayin_e2e");
const [command, payloadRaw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(payloadRaw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (command === "reset") {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ModerationAction", "CreatorTrustState" CASCADE',
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
    const membership = await prisma.channelMember.findFirstOrThrow({
        where: { accountId: payload.accountId, role: "OWNER" },
        include: { channel: true },
      }),
      accountId = membership.accountId,
      channelId = membership.channelId;
    if (command === "seed") {
      const now = Date.now(),
        actions = Array.from({ length: 26 }, (_, index) => ({
          id: randomUUID(),
          actorAccountId: accountId,
          targetAccountId: accountId,
          channelId,
          kind: "WARN",
          reason: `Actual trust fixture reason ${index}`,
          createdAt: new Date(now - index * 60000),
        }));
      await prisma.moderationAction.createMany({ data: actions });
      await prisma.moderationAppeal.createMany({
        data: actions.slice(1).map((action, index) => ({
          actionId: action.id,
          accountId,
          status: "UPHELD",
          message: `Actual reviewed appeal explanation ${index}`,
          resolution: `Actual resolution ${index}`,
          createdAt: action.createdAt,
          updatedAt: action.createdAt,
        })),
      });
      await prisma.notification.createMany({
        data: actions.slice(1).map((action, index) => ({
          accountId,
          type: "MODERATION",
          title: `Actual moderation notice ${index}`,
          body: action.reason,
          data: { actionId: action.id, internalFixtureMarker: "never render this diagnostic" },
          createdAt: action.createdAt,
        })),
      });
      await prisma.creatorTrustState.upsert({
        where: { channelId },
        update: { level: "STANDARD", strikeCount: 0, reviewRequired: false },
        create: { channelId, level: "STANDARD", strikeCount: 0, reviewRequired: false },
      });
      process.stdout.write(
        JSON.stringify({ actionId: actions[0].id, actions: 26, appeals: 25, notices: 25 }),
      );
    } else if (command === "evidence") {
      process.stdout.write(
        JSON.stringify({
          appeals: await prisma.moderationAppeal.count({
            where: { accountId, actionId: payload.actionId },
          }),
        }),
      );
    } else throw Error("Unknown trust fixture command");
  }
} finally {
  await prisma.$disconnect();
}
