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
    const member = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: payload.accountId, role: "OWNER" },
    });
    const profile = await prisma.creatorPayoutProfile.findUniqueOrThrow({
      where: { channelId: member.channelId },
    });
    if (!profile.destinationEncrypted) throw Error("Requires actual encrypted profile");
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    const payout = await prisma.payout.create({
      data: {
        channelId: member.channelId,
        provider: payload.external === true ? "UNCONFIGURED_EXTERNAL" : "MANUAL",
        status: payload.external === true ? "PENDING" : "PROCESSING",
        amount: "210.123456",
        currency: "USD",
        paymentProfileId: profile.id,
        legalNameSnapshot: profile.legalName,
        countryCodeSnapshot: profile.countryCode,
        destinationEncryptedSnapshot: profile.destinationEncrypted,
        destinationMaskSnapshot: profile.destinationMask,
      },
    });
    if (payload.external === true) {
      await prisma.earningsLedgerEntry.create({
        data: {
          channelId: member.channelId,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: payout.amount,
          currency: "USD",
          payoutId: payout.id,
        },
      });
      await prisma.payoutProviderTransfer.create({
        data: {
          payoutId: payout.id,
          provider: payout.provider,
          state: "READY",
          idempotencyKey: `controlled-private-key-${payout.id}`,
          lastErrorMessage: "RAW_PROVIDER_ERROR_MUST_STAY_PRIVATE",
        },
      });
    }
    // A later actual profile update must not replace this payout's immutable beneficiary.
    await prisma.creatorPayoutProfile.update({
      where: { id: profile.id },
      data: { legalName: "Later mutable beneficiary" },
    });
    process.stdout.write(JSON.stringify({ payoutId: payout.id, channelId: member.channelId }));
  } else if (command === "operations") {
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: payload.accountId } });
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "OPERATIONS" },
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "evidence") {
    if (typeof payload.payoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.payoutId))
      throw Error("Invalid payout");
    const audits = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: payload.accountId,
        action: {
          in: ["payout.destination_revealed", "payout.provider_cancelled_before_submission"],
        },
        entityId: payload.payoutId,
      },
      select: { action: true, entityId: true },
    });
    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: payload.payoutId },
      select: { status: true, amount: true, provider: true },
    });
    process.stdout.write(
      JSON.stringify({
        audits,
        payout: { ...payout, amount: String(payout.amount) },
        transfers: await prisma.payoutProviderTransfer.count({
          where: { payoutId: payload.payoutId },
        }),
      }),
    );
  } else throw Error("Unknown payout detail fixture command");
} finally {
  await prisma.$disconnect();
}
