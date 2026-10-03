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
    const target = await prisma.account.findUniqueOrThrow({ where: { id: payload.targetId } });
    const group = randomUUID().slice(0, 8),
      query = "actual-users-" + group + "-";
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "OPERATIONS" },
    });
    await prisma.account.update({
      where: { id: target.id },
      data: {
        email: query + "target@e2e.ayin.test",
        displayName: "Actual original account",
        createdAt: new Date("2026-10-03T12:00:00Z"),
      },
    });
    await prisma.account.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        email: query + i + "@e2e.ayin.test",
        displayName: "Actual paged account " + i,
        createdAt: new Date(Date.UTC(2026, 9, 3, 11, 59 - i)),
        status: i === 0 ? "SUSPENDED" : "ACTIVE",
      })),
    });
    console.log(
      JSON.stringify({ query, targetId: target.id, email: query + "target@e2e.ayin.test" }),
    );
  } else if (command === "finance") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "evidence") {
    const target = await prisma.account.findUniqueOrThrow({
      where: { id: payload.targetId },
      select: { id: true, displayName: true, status: true, authVersion: true },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.targetId },
      select: { revokedAt: true, revokeReason: true },
    });
    const audits = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: payload.accountId,
        entityType: "Account",
        entityId: payload.targetId,
      },
      select: { action: true, reason: true },
    });
    console.log(JSON.stringify({ target, sessions, audits }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
