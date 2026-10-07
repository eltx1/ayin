import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  p = JSON.parse(raw),
  db = createPrismaClient(databaseUrl);
try {
  if (typeof p.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(p.accountId))
    throw Error("Invalid synthetic actor");
  const actor = await db.account.findUniqueOrThrow({ where: { id: p.accountId } });
  if (!actor.email.endsWith("@e2e.ayin.test")) throw Error("Requires synthetic actor");
  if (command === "seed") {
    await db.adminRoleAssignment.create({ data: { accountId: p.accountId, role: "AD_MANAGER" } });
    const prefix = "editor-" + randomUUID().slice(0, 8) + "-";
    const advertisers = [];
    for (const label of ["ألف", "باء"])
      advertisers.push(await db.advertiser.create({ data: { name: prefix + label } }));
    const campaigns = [];
    for (let n = 0; n < 102; n++)
      campaigns.push(
        await db.campaign.create({
          data: {
            advertiserId: advertisers[n === 101 ? 1 : 0].id,
            name:
              prefix +
              (n === 0 || n === 101 ? "حملة مشتركة" : "Campaign " + String(n).padStart(3, "0")),
            status: "DRAFT",
          },
        }),
      );
    const creative = await db.creative.create({
      data: {
        campaignId: campaigns[0].id,
        name: prefix + "مادة أصلية",
        type: "DISPLAY",
        status: "DRAFT",
        headline: "عنوان تجريبي",
        body: "نص محلي اصطناعي للاختبار",
      },
    });
    await db.directCreativeConfig.create({
      data: {
        creativeId: creative.id,
        assetUrl: "https://example.test/synthetic.png",
        width: 300,
        height: 250,
        approvedReference: "Synthetic approval",
      },
    });
    const placement = await db.adPlacement.create({
      data: {
        key: prefix + "placement",
        name: prefix + "موضع تجريبي",
        inventoryFamily: "OUTSIDE_PLAYER",
        format: "DISPLAY",
        enabled: false,
        config: {
          routePatterns: ["/*", "/watch/*"],
          sizes: [[300, 250]],
          responsive: [],
          devices: ["MOBILE", "DESKTOP"],
          audience: "ANY",
          categories: [],
          demand: { source: "HOUSE", adUnitPath: null },
          fallback: "HOUSE",
        },
      },
    });
    const baselineAuditIds = (
      await db.adminAuditLog.findMany({
        where: { actorAccountId: p.accountId },
        select: { id: true },
      })
    ).map((row) => row.id);
    console.log(
      JSON.stringify({ prefix, advertisers, campaigns, creative, placement, baselineAuditIds }),
    );
  } else if (command === "evidence") {
    if (
      !Array.isArray(p.baselineAuditIds) ||
      p.baselineAuditIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    )
      throw Error("Missing synthetic audit baseline");
    const advertisers = await db.advertiser.findMany({
      where: { name: { startsWith: p.prefix } },
      select: { id: true },
    });
    const campaigns = await db.campaign.findMany({
      where: { advertiserId: { in: advertisers.map((a) => a.id) } },
      select: { id: true },
    });
    const creatives = await db.creative.findMany({
      where: { campaignId: { in: campaigns.map((c) => c.id) } },
      orderBy: { createdAt: "asc" },
    });
    const placements = await db.adPlacement.findMany({ where: { key: { startsWith: p.prefix } } });
    const audits = await db.adminAuditLog.findMany({
      where: { actorAccountId: p.accountId, id: { notIn: p.baselineAuditIds } },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityId: true },
    });
    console.log(JSON.stringify({ creatives, placements, audits }));
  } else if (command === "change-creative") {
    const row = await db.creative.findUniqueOrThrow({ where: { id: p.creative.id } });
    if (!row.name.startsWith(p.prefix)) throw Error("Outside synthetic fixture");
    console.log(
      JSON.stringify(
        await db.creative.update({
          where: { id: row.id },
          data: { name: p.prefix + "concurrent" },
        }),
      ),
    );
  } else if (command === "revoke-role") {
    await db.adminRoleAssignment.deleteMany({
      where: { accountId: p.accountId, role: "AD_MANAGER" },
    });
    await db.adminRoleAssignment.create({
      data: { accountId: p.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ changed: true }));
  } else if (command === "cleanup") {
    if (!/^editor-[0-9a-f]{8}-$/.test(p.prefix)) throw Error("Invalid synthetic prefix");
    const advertisers = await db.advertiser.findMany({
      where: { name: { startsWith: p.prefix } },
      select: { id: true },
    });
    const campaigns = await db.campaign.findMany({
      where: { advertiserId: { in: advertisers.map((a) => a.id) } },
      select: { id: true },
    });
    await db.creative.deleteMany({ where: { campaignId: { in: campaigns.map((c) => c.id) } } });
    await db.campaign.deleteMany({ where: { id: { in: campaigns.map((c) => c.id) } } });
    await db.advertiser.deleteMany({ where: { id: { in: advertisers.map((a) => a.id) } } });
    await db.adPlacement.deleteMany({ where: { key: { startsWith: p.prefix } } });
    await db.adminAuditLog.deleteMany({ where: { actorAccountId: p.accountId } });
    await db.account.delete({ where: { id: p.accountId } });
    console.log(JSON.stringify({ cleaned: true }));
  } else throw Error("Unknown synthetic fixture command");
} finally {
  await db.$disconnect();
}
