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
  if (command === "seed") {
    // Account reset preserves ownerless channels from earlier real browser fixtures.
    // Isolate this sitemap scenario without deleting their related records.
    await prisma.channel.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "SUSPENDED" },
    });
    const group = randomUUID().slice(0, 8),
      channel = await prisma.channel.create({
        data: { name: "Actual sitemap creator", handle: "sitemap-creator-" + group },
      });
    const videos = [];
    for (const kind of ["expired", "eligible"]) {
      const video = await prisma.video.create({
        data: {
          channelId: channel.id,
          title: "Actual " + kind + " sitemap film",
          slug: "sitemap-" + kind + "-" + group,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          publishedAt: new Date(),
          mediaAssets: {
            create: {
              channelId: channel.id,
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              mimeType: "video/mp4",
              sizeBytes: 1024n,
              r2ObjectKey: "actual-sitemap/" + group + "-" + kind + ".mp4",
            },
          },
        },
      });
      if (kind === "expired")
        await prisma.videoPolicy.create({
          data: { videoId: video.id, rightsExpiresAt: new Date("2000-01-01T00:00:00Z") },
        });
      videos.push(video);
    }
    const expired = videos[0],
      eligible = videos[1];
    if (!expired || !eligible) throw Error("Missing actual sitemap fixture");
    const playlist = await prisma.playlist.create({
      data: {
        channelId: channel.id,
        name: "Actual eligible sitemap playlist",
        slug: "sitemap-collection",
        items: {
          create: [
            { videoId: expired.id, position: 0 },
            { videoId: eligible.id, position: 1 },
          ],
        },
      },
    });
    console.log(
      JSON.stringify({
        videoId: eligible.id,
        videoSlug: eligible.slug,
        handle: channel.handle,
        playlistSlug: playlist.slug,
      }),
    );
  } else if (command === "withdraw") {
    if (typeof payload.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.videoId))
      throw Error("Invalid actual video");
    await prisma.videoPolicy.create({
      data: { videoId: payload.videoId, rightsExpiresAt: new Date("2000-01-01T00:00:00Z") },
    });
    console.log(JSON.stringify({ videoId: payload.videoId }));
  } else throw Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
