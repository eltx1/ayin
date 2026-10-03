import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "",
  url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw Error("Creator TV fixture requires isolated local ayin_e2e");
const [command, payloadRaw = "{}"] = process.argv.slice(2),
  payload = JSON.parse(payloadRaw),
  prisma = createPrismaClient(databaseUrl);
try {
  if (
    typeof payload.accountId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.accountId,
    )
  )
    throw Error("Invalid fixture account");
  const membership = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: payload.accountId, role: "OWNER" },
      include: { channel: { select: { primaryTvChannelId: true } } },
    }),
    channelId = membership.channelId,
    tvChannelId = membership.channel.primaryTvChannelId;
  if (!tvChannelId) throw Error("Registration must create the actual primary TV channel");
  if (command === "seed") {
    const now = Date.now(),
      videos = [];
    for (let index = 0; index < 26; index++) {
      const video = await prisma.video.create({
        data: {
          channelId,
          slug: `tv-management-${randomUUID()}`,
          title: `Actual TV video ${String(index).padStart(2, "0")}`,
          description: `Actual description ${index} END`,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date(now - (26 - index) * 60000),
          durationMs: index === 0 ? null : 60000,
          mediaAssets: {
            create: {
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              r2ObjectKey: `e2e-tv-management/${randomUUID()}.mp4`,
              mimeType: "video/mp4",
              sizeBytes: 128n,
              durationMs: index === 0 ? null : 60000,
            },
          },
        },
      });
      videos.push(video);
    }
    await prisma.creatorTvVideoPreference.create({
      data: { tvChannelId, videoId: videos[0].id, included: false, priority: 0, sortOrder: 0 },
    });
    process.stdout.write(
      JSON.stringify({ channelId, tvChannelId, videoId: videos[0].id, rows: videos.length }),
    );
  } else if (command === "evidence") {
    if (typeof payload.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.videoId))
      throw Error("Invalid evidence id");
    const row = await prisma.creatorTvVideoPreference.findUnique({
      where: { tvChannelId_videoId: { tvChannelId, videoId: payload.videoId } },
      select: { included: true, priority: true, sortOrder: true },
    });
    process.stdout.write(JSON.stringify({ preference: row }));
  } else throw Error("Unknown Creator TV fixture command");
} finally {
  await prisma.$disconnect();
}
