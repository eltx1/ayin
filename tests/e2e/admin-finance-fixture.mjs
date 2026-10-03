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
  const member = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: payload.accountId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
    }),
    channelId = member.channelId;
  if (command === "seed") {
    // This suite runs serially on the guarded disposable database. Old unowned channel records
    // survive Account truncation, so clear financial fixtures explicitly before asserting DB pages.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "EarningsLedgerEntry", "Payout", "RevenueDispute" CASCADE',
    );
    await prisma.platformSetting.deleteMany({ where: { namespace: "MONETIZATION" } });
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    const group = randomUUID().slice(0, 8),
      handle = `finance-${group}-a`;
    await prisma.channel.update({
      where: { id: channelId },
      data: { name: "Actual financial channel A", handle },
    });
    const second = await prisma.channel.create({
      data: {
        name: "Actual financial channel B",
        handle: `finance-${group}-b`,
        members: { create: { accountId: payload.accountId, role: "OWNER" } },
      },
    });
    await prisma.creatorContract.deleteMany({ where: { channelId } });
    await prisma.creatorContract.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        channelId,
        status: "ACTIVE",
        revenueShareBps: i === 0 ? null : 0,
        termsVersion: `Actual terms ${i}`,
        effectiveFrom: new Date(Date.now() - i * 60000),
        createdAt: new Date(Date.now() - i * 60000),
      })),
    });
    let payoutId;
    for (let i = 0; i < 26; i++) {
      const payout = await prisma.payout.create({
        data: {
          channelId,
          amount: "210.123456",
          currency: "USD",
          provider: "MANUAL",
          status: i === 0 ? "PROCESSING" : "PAID",
          paidAt: i === 0 ? null : new Date(Date.now() - i * 60000),
          requestedAt: new Date(Date.now() - i * 60000),
        },
      });
      if (i === 0) payoutId = payout.id;
      await prisma.revenueDispute.create({
        data: {
          channelId,
          createdByAccountId: payload.accountId,
          category: "EARNINGS",
          message: `Actual financial dispute ${String(i).padStart(2, "0")} complete message END`,
          status: "OPEN",
          createdAt: new Date(Date.now() - i * 60000),
        },
      });
    }
    await prisma.earningsLedgerEntry.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "1.123456",
        grossAmount: "1.123456",
        currency: "USD",
        revenueShareBps: 10000,
        occurredAt: new Date(Date.now() - i * 60000),
        adSource: `Actual source ${i}`,
      })),
    });
    await prisma.adminAuditLog.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        actorAccountId: payload.accountId,
        action: "PAYOUT_CREATED",
        entityType: "Payout",
        entityId: payoutId,
        createdAt: new Date(Date.now() - i * 60000),
        metadata: { channelId, amount: "210.123456", currency: "USD", entryCount: 0 },
      })),
    });
    process.stdout.write(
      JSON.stringify({
        channelId,
        handle,
        query: `finance-${group}-`,
        secondId: second.id,
        secondHandle: second.handle,
        payoutId,
      }),
    );
  } else if (command === "operations") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "OPERATIONS" },
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "evidence") {
    const audits = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: payload.accountId,
        action: {
          in: [
            "REVENUE_SETTINGS_UPDATED",
            "REVENUE_ADJUSTMENT_CREATED",
            "CREATOR_CONTRACT_CREATED",
            "REVENUE_IMPORTED",
            "revenue.dispute_updated",
            "creator.compliance_status_overridden",
            "PAYOUT_STATUS_UPDATED",
          ],
        },
      },
      select: { action: true, entityId: true, metadata: true },
    });
    const settings = await prisma.platformSetting.findMany({
      where: { namespace: "MONETIZATION" },
      select: { key: true, value: true },
    });
    const adjustments = await prisma.earningsLedgerEntry.findMany({
      where: { channelId, type: "ADJUSTMENT" },
      select: { amount: true, currency: true, memo: true },
    });
    process.stdout.write(
      JSON.stringify({
        audits,
        settings,
        adjustments: adjustments.map((row) => ({ ...row, amount: String(row.amount) })),
      }),
    );
  } else throw Error("Unknown finance fixture command");
} finally {
  await prisma.$disconnect();
}
