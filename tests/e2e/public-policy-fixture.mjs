import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Requires isolated local ayin_e2e");
const prisma = createPrismaClient(databaseUrl);
try {
  const group = randomUUID().slice(0, 8);
  const channel = await prisma.channel.create({
    data: { name: "Actual eligible creator", handle: "eligible-creator-" + group },
  });
  const playlist = await prisma.playlist.create({
    data: {
      channelId: channel.id,
      name: "Actual eligible collection",
      slug: "eligible-collection",
      description: "Available videos in their original order.",
    },
  });
  const videos = {};
  for (const [position, [key, title]] of Object.entries({
    general: "Actual general film",
    teen: "Actual teen film",
    expired: "Actual expired film",
    restricted: "Actual DE film",
    blocked: "Actual blocked film",
  }).entries()) {
    const id = randomUUID();
    await prisma.video.create({
      data: {
        id,
        channelId: channel.id,
        slug: "eligible-" + key + "-" + group,
        title,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(Date.now() - position * 1000),
        durationMs: 90_000,
        mediaAssets: {
          create: {
            channelId: channel.id,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            sizeBytes: 1024n,
            r2ObjectKey: "eligible-fixture/" + id + ".mp4",
          },
        },
      },
    });
    await prisma.videoPolicy.create({
      data: {
        videoId: id,
        maturityLevel: key === "teen" ? "TEEN" : "GENERAL",
        kidsEligible: true,
        ...(key === "restricted" ? { allowedTerritories: ["DE"] } : {}),
        ...(key === "expired" ? { rightsExpiresAt: new Date("2000-01-01T00:00:00Z") } : {}),
      },
    });
    if (key === "blocked")
      await prisma.videoPolicyOverride.create({
        data: {
          videoId: id,
          disposition: "FORCE_BLOCK",
          reason: "Controlled browser fixture block",
          actorAccountId: randomUUID(),
        },
      });
    await prisma.playlistItem.create({
      data: { playlistId: playlist.id, videoId: id, position: position * 3 },
    });
    videos[key] = { id, title, slug: "eligible-" + key + "-" + group };
  }
  await prisma.channelHandleRedirect.create({
    data: { oldHandle: "old-eligible-" + group, channelId: channel.id },
  });
  console.log(
    JSON.stringify({
      handle: channel.handle,
      oldHandle: "old-eligible-" + group,
      playlistSlug: playlist.slug,
      videos,
    }),
  );
} finally {
  await prisma.$disconnect();
}
