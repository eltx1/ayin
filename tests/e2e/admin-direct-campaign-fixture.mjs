import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  p = JSON.parse(raw),
  db = createPrismaClient(databaseUrl);
try {
  if (typeof p.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(p.accountId))
    throw Error("Invalid actor");
  await db.account.findUniqueOrThrow({ where: { id: p.accountId } });
  if (command === "seed") {
    await db.adminRoleAssignment.create({ data: { accountId: p.accountId, role: "AD_MANAGER" } });
    const prefix = "native-direct-" + randomUUID().slice(0, 8) + "-",
      advertisers = [],
      campaigns = [];
    for (let n = 0; n < 27; n++) {
      const advertiser = await db.advertiser.create({
        data: { name: prefix + "advertiser-" + String(n).padStart(2, "0") },
      });
      advertisers.push(advertiser);
      const campaign = await db.campaign.create({
        data: {
          advertiserId: advertiser.id,
          name: prefix + "campaign-" + String(n).padStart(2, "0"),
          status: "DRAFT",
          budget: "12345678901234.123456",
          currency: null,
          startsAt: new Date("2035-02-01T10:20:30.123Z"),
          endsAt: new Date("2035-03-01T10:20:30.789Z"),
        },
      });
      campaigns.push(campaign);
      await db.directCampaignConfig.create({
        data: {
          campaignId: campaign.id,
          priority: 700,
          pricing: { model: "FIXED", cpm: null, fixedPrice: "98765432109876.123456" },
          frequencyCap: 0,
          pacing: "ASAP",
          targeting: {
            placementKeys: [prefix + "unknown-placement"],
            countries: ["US"],
            regions: ["saved, literal"],
            categories: ["Documentary"],
            devices: ["TV"],
            channelIds: [],
            videoIds: [],
          },
        },
      });
    }
    console.log(JSON.stringify({ prefix, advertisers, campaigns }));
  } else if (command === "evidence") {
    const advertisers = await db.advertiser.findMany({
      where: { name: { startsWith: p.prefix } },
      orderBy: { name: "asc" },
    });
    const campaigns = await db.campaign.findMany({
      where: { advertiserId: { in: advertisers.map((r) => r.id) } },
      orderBy: { name: "asc" },
    });
    const configs = await db.directCampaignConfig.findMany({
      where: { campaignId: { in: campaigns.map((r) => r.id) } },
    });
    const audits = await db.adminAuditLog.findMany({
      where: {
        actorAccountId: p.accountId,
        action: {
          in: [
            "ADVERTISER_CREATED",
            "ADVERTISER_UPDATED",
            "ADVERTISER_DELETED",
            "CAMPAIGN_CREATED",
            "CAMPAIGN_UPDATED",
            "CAMPAIGN_DELETED",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
    });
    console.log(
      JSON.stringify({ advertisers, campaigns, configs, audits }, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
  } else if (command === "change-campaign") {
    const current = await db.campaign.findUniqueOrThrow({ where: { id: p.campaignId } });
    if (!current.name.startsWith(p.prefix)) throw Error("Target outside fixture");
    const campaign = await db.campaign.update({
      where: { id: current.id },
      data: {
        name: p.prefix + "concurrent-edit",
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      },
    });
    console.log(JSON.stringify(campaign));
  } else if (command === "revoke-role") {
    await db.adminRoleAssignment.deleteMany({
      where: { accountId: p.accountId, role: "AD_MANAGER" },
    });
    await db.adminRoleAssignment.create({
      data: { accountId: p.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ changed: true }));
  } else if (command === "expire-step-up") {
    // This command changes only this isolated actor's session age through the existing test helper route replacement; no token manipulation.
    throw Error("Use the actual verification timeout response in browser interception");
  } else if (command === "cleanup") {
    if (typeof p.prefix !== "string" || !/^native-direct-[a-f0-9]{8}-$/.test(p.prefix))
      throw Error("Invalid fixture prefix");
    const advertisers = await db.advertiser.findMany({
      where: { name: { startsWith: p.prefix } },
      select: { id: true },
    });
    const campaigns = await db.campaign.findMany({
      where: { advertiserId: { in: advertisers.map((r) => r.id) } },
      select: { id: true },
    });
    await db.directCampaignConfig.deleteMany({
      where: { campaignId: { in: campaigns.map((r) => r.id) } },
    });
    await db.campaign.deleteMany({ where: { id: { in: campaigns.map((r) => r.id) } } });
    await db.advertiser.deleteMany({ where: { id: { in: advertisers.map((r) => r.id) } } });
    await db.adminAuditLog.deleteMany({ where: { actorAccountId: p.accountId } });
    await db.account.delete({ where: { id: p.accountId } });
    console.log(JSON.stringify({ cleaned: true }));
  } else throw Error("Unknown fixture action");
} finally {
  await db.$disconnect();
}
