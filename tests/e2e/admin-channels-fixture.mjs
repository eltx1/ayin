import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Admin channels fixture requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(raw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (typeof payload.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.accountId))
    throw Error("Invalid fixture account");
  await prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } });
  if (command === "seed") {
    await prisma.adminRoleAssignment.upsert({
      where: { accountId_role: { accountId: payload.accountId, role: "OPERATIONS" } },
      update: {},
      create: { accountId: payload.accountId, role: "OPERATIONS" },
    });
    const channels = [];
    const group = randomUUID().slice(0, 8);
    for (let i = 0; i < 26; i++) {
      const row = await prisma.channel.create({
        data: {
          name: `Managed channel ${String(i).padStart(2, "0")}`,
          handle: `managed-${group}-${i}`,
          description: `Actual managed channel description ${i} END`,
          createdAt: new Date(Date.now() - i * 60000),
          members: { create: { accountId: payload.accountId, role: "OWNER" } },
          creatorContracts: {
            create: {
              status: "ACTIVE",
              revenueShareBps: null,
              effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            },
          },
        },
        select: { id: true, handle: true },
      });
      channels.push(row);
    }
    process.stdout.write(
      JSON.stringify({
        query: `managed-${group}-`,
        channelId: channels[0].id,
        handle: channels[0].handle,
        secondId: channels[1].id,
        secondHandle: channels[1].handle,
        rows: 26,
      }),
    );
  } else if (command === "finance-role") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "evidence") {
    if (typeof payload.channelId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.channelId))
      throw Error("Invalid channel");
    const row = await prisma.channel.findUniqueOrThrow({
      where: { id: payload.channelId },
      select: {
        name: true,
        status: true,
        isPlatformOwned: true,
        creatorContracts: {
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { status: true, revenueShareBps: true },
        },
      },
    });
    process.stdout.write(
      JSON.stringify({
        channel: row,
        audits: await prisma.adminAuditLog.count({
          where: {
            actorAccountId: payload.accountId,
            action: "channel.admin_updated",
            entityId: payload.channelId,
          },
        }),
      }),
    );
  } else throw Error("Unknown channel fixture command");
} finally {
  await prisma.$disconnect();
}
