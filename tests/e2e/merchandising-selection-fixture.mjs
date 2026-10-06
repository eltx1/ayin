import { createPrismaClient } from "../../packages/db/dist/index.js";
import { defaultProductControls } from "../../apps/api/dist/admin/admin-product-config.js";
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
const [command, raw = "{}"] = process.argv.slice(2),
  input = JSON.parse(raw);
try {
  let result;
  if (command === "reset") {
    await prisma.homeRowConfig.deleteMany({ where: { key: "e2e-merch-choice" } });
    await prisma.platformSetting.deleteMany({
      where: { namespace: "DISCOVERY", key: "productControls" },
    });
    await prisma.video.deleteMany({ where: { channel: { handle: "merch-creator" } } });
    await prisma.creatorContract.deleteMany({ where: { channel: { handle: "merch-creator" } } });
    await prisma.channel.deleteMany({ where: { handle: "merch-creator" } });
    result = { ok: true };
  } else if (command === "seed") {
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: input.channelId } });
    await prisma.channel.update({
      where: { id: channel.id },
      data: { name: "Merch creator · مبدع المحتوى", handle: "merch-creator" },
    });
    const tv = await prisma.creatorTvChannel.update({
      where: { id: channel.primaryTvChannelId },
      data: { name: "Merch live stories · قصص مباشرة" },
    });
    const videos = [];
    for (let index = 0; index < 27; index++)
      videos.push(
        await prisma.video.create({
          data: {
            channelId: channel.id,
            title: `Merch story ${String(index).padStart(2, "0")} · حكاية`,
            slug: `merch-story-${index}`,
            status: index === 26 ? "REMOVED" : "PUBLISHED",
            visibility: index === 25 ? "PRIVATE" : "PUBLIC",
            publishedAt: new Date("2026-09-01T00:00:00Z"),
            updatedAt: new Date(1_750_000_000_000 + index * 1000),
            durationMs: 60_000,
            mediaAssets: {
              create: {
                channelId: channel.id,
                kind: "SOURCE_VIDEO",
                status: "VALIDATED",
                mimeType: "video/mp4",
                r2ObjectKey: `merch/${index}.mp4`,
                sizeBytes: 1024n,
              },
            },
          },
        }),
      );
    const playlists = [];
    for (let index = 0; index < 27; index++)
      playlists.push(
        await prisma.playlist.create({
          data: {
            channelId: channel.id,
            name: `Merch collection ${String(index).padStart(2, "0")} · مجموعة`,
            slug: `merch-collection-${index}`,
            visibility: index === 26 ? "PRIVATE" : "PUBLIC",
            isPublic: index !== 26,
            updatedAt: new Date(1_750_000_000_000 + index * 1000),
          },
        }),
      );
    const deleted = await prisma.playlist.create({
      data: {
        channelId: channel.id,
        name: "Merch deleted collection",
        slug: "merch-deleted",
        deletedAt: new Date(),
      },
    });
    const row = await prisma.homeRowConfig.create({
      data: {
        key: "e2e-merch-choice",
        title: "Weekend discoveries · اكتشافات الأسبوع",
        source: "EDITOR_PICKS",
        audience: "ALL",
        maxItems: 8,
        enabled: false,
        position: 500,
        manualItems: {
          create: [
            { entityType: "VIDEO", entityId: videos[26].id, position: 0 },
            { entityType: "PLAYLIST", entityId: deleted.id, position: 1 },
          ],
        },
      },
    });
    await prisma.platformSetting.create({
      data: {
        namespace: "DISCOVERY",
        key: "productControls",
        valueType: "JSON",
        value: {
          ...defaultProductControls,
          hero: { entityType: "PLAYLIST", entityId: playlists[26].id },
        },
      },
    });
    result = {
      rowId: row.id,
      channelId: channel.id,
      tvId: tv.id,
      videos: videos.map(({ id, title }) => ({ id, title })),
      playlists: playlists.map(({ id, name }) => ({ id, name })),
      deletedId: deleted.id,
    };
  } else if (command === "evidence") {
    result = {
      row: await prisma.homeRowConfig.findUnique({
        where: { id: input.rowId },
        include: { manualItems: { orderBy: { position: "asc" } } },
      }),
      controls: await prisma.platformSetting.findUnique({
        where: { namespace_key: { namespace: "DISCOVERY", key: "productControls" } },
      }),
      audits: await prisma.adminAuditLog.findMany({
        where: {
          actorAccountId: input.accountId,
          action: { in: ["PRODUCT_CONTROLS_UPDATED", "HOME_ROW_MANUAL_ITEMS_REPLACED"] },
        },
        orderBy: { createdAt: "asc" },
      }),
    };
  } else if (command === "revoke") {
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: input.accountId } });
    result = { ok: true };
  } else if (command === "missing") {
    await prisma.homeRowManualItem.create({
      data: {
        rowId: input.rowId,
        entityType: "VIDEO",
        entityId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        position: 2,
      },
    });
    result = { ok: true };
  } else throw new Error("Unknown merchandising fixture command");
  console.log(
    JSON.stringify(result, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
} finally {
  await prisma.$disconnect();
}
