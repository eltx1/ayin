import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(raw),
  prisma = createPrismaClient(databaseUrl);
const defaults = {
  masterEnabled: false,
  provider: "GOOGLE_IMA",
  preRollEnabled: true,
  midRollEnabled: false,
  postRollEnabled: false,
  midRollEverySec: 600,
  frequencyCapPerSession: 3,
  externalVastTagUrl: null,
  houseCreativeUrl: null,
  houseClickUrl: null,
};
try {
  if (typeof payload.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.accountId))
    throw Error("Invalid actor");
  await prisma.account.findUniqueOrThrow({ where: { id: payload.accountId } });
  if (command === "seed") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "AD_MANAGER" },
    });
    const group = randomUUID().slice(0, 8),
      query = "actual-ad-" + group + "-";
    const channel = await prisma.channel.create({
        data: { name: query + "owner", handle: "ad-owner-" + group },
      }),
      records = [];
    for (let n = 0; n < 27; n++) {
      const v = await prisma.video.create({
        data: {
          channelId: channel.id,
          title: query + (n === 0 ? "target" : n === 26 ? "default" : String(n)),
          slug: query + n,
          status: "PUBLISHED",
          visibility: "PRIVATE",
        },
      });
      if (n < 26) {
        const row = await prisma.videoAdOverride.create({
          data: {
            videoId: v.id,
            enabled: false,
            midRollEverySec: 600,
            updatedBy: payload.accountId,
            updatedAt: new Date(Date.UTC(2035, 0, 1, 12, 0, 26 - n)),
          },
        });
        records.push({ video: v, override: row });
      } else records.push({ video: v, override: null });
    }
    const setting = await prisma.platformSetting.upsert({
      where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
      create: {
        namespace: "ADVERTISING",
        key: "videoAdsV1",
        valueType: "JSON",
        value: defaults,
        updatedAt: new Date("2035-01-01T00:00:00Z"),
      },
      update: { value: defaults, valueType: "JSON", updatedAt: new Date("2035-01-01T00:00:00Z") },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    console.log(
      JSON.stringify({
        query,
        channelId: channel.id,
        name: records[0].video.title,
        targetId: records[0].video.id,
        overrideId: records[0].override.id,
        defaultName: records[26].video.title,
        defaultId: records[26].video.id,
        settingsId: setting.id,
        sessions,
      }),
    );
  } else if (command === "finance") {
    await prisma.adminRoleAssignment.create({
      data: { accountId: payload.accountId, role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "change-role") {
    await prisma.adminRoleAssignment.updateMany({
      where: { accountId: payload.accountId, role: "AD_MANAGER" },
      data: { role: "FINANCE_MANAGER" },
    });
    console.log(JSON.stringify({ accountId: payload.accountId }));
  } else if (command === "change-settings") {
    const row = await prisma.platformSetting.findUniqueOrThrow({
      where: { id: payload.settingsId },
    });
    const next = await prisma.platformSetting.update({
      where: { id: row.id },
      data: {
        value: { ...defaults, frequencyCapPerSession: 7 },
        updatedAt: new Date(
          Math.max(new Date("2037-01-01T00:00:00Z").getTime(), row.updatedAt.getTime() + 1),
        ),
      },
    });
    console.log(JSON.stringify({ updatedAt: next.updatedAt }));
  } else if (command === "change-override") {
    const target = payload.targetId ?? payload.defaultId;
    const row = await prisma.videoAdOverride.findUnique({ where: { videoId: target } });
    const next = await prisma.videoAdOverride.upsert({
      where: { videoId: target },
      create: {
        videoId: target,
        enabled: false,
        midRollEverySec: 1200,
        updatedAt: new Date("2037-01-01T00:00:00Z"),
      },
      update: {
        midRollEverySec: 1200,
        updatedAt: new Date(
          Math.max(new Date("2037-01-01T00:00:00Z").getTime(), (row?.updatedAt.getTime() ?? 0) + 1),
        ),
      },
    });
    console.log(JSON.stringify({ id: next.id, updatedAt: next.updatedAt }));
  } else if (command === "delete-target") {
    await prisma.video.delete({ where: { id: payload.targetId } });
    console.log(JSON.stringify({ deleted: true }));
  } else if (command === "evidence") {
    const setting = await prisma.platformSetting.findUniqueOrThrow({
      where: { id: payload.settingsId },
    });
    const videos = await prisma.video.findMany({
      where: { channelId: payload.channelId },
      select: { id: true },
    });
    const overrides = await prisma.videoAdOverride.findMany({
      where: { videoId: { in: videos.map((v) => v.id) } },
      orderBy: { id: "asc" },
    });
    const audits = await prisma.adminAuditLog.findMany({
      where: { actorAccountId: payload.accountId, action: { startsWith: "VIDEO_AD_" } },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityId: true, metadata: true },
    });
    const sessions = await prisma.accountSession.findMany({
      where: { accountId: payload.accountId },
      orderBy: { id: "asc" },
      select: { id: true, revokedAt: true, revokeReason: true, authVersion: true },
    });
    console.log(
      JSON.stringify({
        settings: { value: setting.value, updatedAt: setting.updatedAt },
        overrides,
        audits,
        emergencyAudits: await prisma.adminAuditLog.findMany({
          where: { actorAccountId: payload.accountId, action: "AD_EMERGENCY_KILL_SWITCH_UPDATED" },
          select: { action: true, entityId: true },
        }),
        sessions,
      }),
    );
  } else throw Error("Unknown command");
} finally {
  await prisma.$disconnect();
}
