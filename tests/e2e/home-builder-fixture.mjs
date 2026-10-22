import { createPrismaClient, Prisma } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw new Error("Home builder fixture requires isolated local ayin_e2e.");
const db = createPrismaClient(databaseUrl);
const [command, raw = "{}"] = process.argv.slice(2);
const input = JSON.parse(raw);
const modeWhere = { namespace: "DISCOVERY", key: "homeDiscoveryMode" };

try {
  if (["grant", "evidence", "cleanup"].includes(command)) {
    const account = await db.account.findUniqueOrThrow({
      where: { id: input.accountId },
      select: { email: true, channelMemberships: { select: { channelId: true } } },
    });
    if (!account.email?.startsWith("home-builder-") || !account.email.endsWith("@e2e.ayin.test"))
      throw new Error("Expected this scenario's test account.");
    if (
      command === "cleanup" &&
      !account.channelMemberships.some((membership) => membership.channelId === input.channelId)
    )
      throw new Error("Expected this scenario's test channel.");
  }
  let result = { ok: true };
  if (command === "grant") {
    await db.adminRoleAssignment.create({
      data: { accountId: input.accountId, role: "OPERATIONS" },
    });
  } else if (command === "snapshot") {
    result = await db.$transaction(async (tx) => ({
      rows: await tx.homeRowConfig.findMany(),
      manualItems: await tx.homeRowManualItem.findMany(),
      regionTargets: await tx.homeRowRegionTarget.findMany(),
      mode: await tx.platformSetting.findUnique({ where: { namespace_key: modeWhere } }),
    }));
  } else if (command === "empty") {
    await db.$transaction(async (tx) => {
      await tx.homeRowConfig.deleteMany();
      await tx.platformSetting.deleteMany({ where: modeWhere });
    });
  } else if (command === "evidence") {
    result = {
      rows: await db.homeRowConfig.findMany({ orderBy: { key: "asc" } }),
      mode: await db.platformSetting.findUnique({ where: { namespace_key: modeWhere } }),
      creationAudits: await db.adminAuditLog.findMany({
        where: { actorAccountId: input.accountId, action: "HOME_ROW_CREATED" },
      }),
      modeAudits: await db.adminAuditLog.findMany({
        where: {
          actorAccountId: input.accountId,
          action: "platform_setting.updated",
          entityId: "DISCOVERY.homeDiscoveryMode",
        },
      }),
    };
  } else if (command === "restore") {
    await db.$transaction(async (tx) => {
      await tx.homeRowConfig.deleteMany();
      await tx.platformSetting.deleteMany({ where: modeWhere });
      if (input.rows.length) await tx.homeRowConfig.createMany({ data: input.rows });
      if (input.manualItems.length)
        await tx.homeRowManualItem.createMany({ data: input.manualItems });
      if (input.regionTargets.length)
        await tx.homeRowRegionTarget.createMany({ data: input.regionTargets });
      if (input.mode)
        await tx.platformSetting.create({
          data: { ...input.mode, value: input.mode.value ?? Prisma.JsonNull },
        });
    });
  } else if (command === "cleanup") {
    await db.$transaction(async (tx) => {
      await tx.adminAuditLog.deleteMany({ where: { actorAccountId: input.accountId } });
      await tx.adminRoleAssignment.deleteMany({ where: { accountId: input.accountId } });
      await tx.channel.deleteMany({ where: { id: input.channelId } });
      await tx.account.deleteMany({ where: { id: input.accountId } });
    });
  } else throw new Error("Unknown home builder fixture command.");
  process.stdout.write(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
