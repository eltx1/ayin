import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Finance fixture requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(raw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (typeof payload.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.accountId))
    throw Error("Invalid account");
  const member = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: payload.accountId, role: "OWNER" },
    }),
    channelId = member.channelId;
  if (command === "seed") {
    await prisma.platformSetting.deleteMany({ where: { namespace: "MONETIZATION" } });
    await prisma.earningsLedgerEntry.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "1.123456",
        currency: "USD",
        occurredAt: new Date(Date.now() - i * 86400000),
        periodStart: new Date(Date.now() - i * 86400000),
        adSource: `Actual source ${String(i).padStart(2, "0")}`,
      })),
    });
    for (let i = 0; i < 26; i++) {
      await prisma.payout.create({
        data: {
          channelId,
          amount: "0.000001",
          currency: "USD",
          status: "PAID",
          requestedAt: new Date(Date.now() - i * 60000),
          paidAt: new Date(Date.now() - i * 60000),
        },
      });
      await prisma.revenueDispute.create({
        data: {
          channelId,
          createdByAccountId: payload.accountId,
          category: "EARNINGS",
          message: `Actual finance dispute ${String(i).padStart(2, "0")} complete message END`,
          status: "OPEN",
          createdAt: new Date(Date.now() - i * 60000),
        },
      });
    }
    process.stdout.write(JSON.stringify({ channelId, days: 40, sources: 40, disputes: 26 }));
  } else if (command === "evidence") {
    const profile = await prisma.creatorPayoutProfile.findUnique({
      where: { channelId },
      select: {
        legalName: true,
        preferredCurrency: true,
        provider: true,
        destinationMask: true,
        destinationEncrypted: true,
      },
    });
    process.stdout.write(
      JSON.stringify({
        profile: profile
          ? {
              legalName: profile.legalName,
              currency: profile.preferredCurrency,
              provider: profile.provider,
              mask: profile.destinationMask,
              encrypted: Boolean(profile.destinationEncrypted),
            }
          : null,
        profileAudits: await prisma.adminAuditLog.count({
          where: { actorAccountId: payload.accountId, action: "creator.payout_profile_updated" },
        }),
        disputes: await prisma.revenueDispute.count({ where: { channelId } }),
        disputeAudits: await prisma.adminAuditLog.count({
          where: { actorAccountId: payload.accountId, action: "creator.revenue_dispute_created" },
        }),
      }),
    );
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
