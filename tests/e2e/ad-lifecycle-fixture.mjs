import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const prisma = createPrismaClient(databaseUrl);
const [command, rawInput = "{}"] = process.argv.slice(2);
const input = JSON.parse(rawInput);

try {
  if (command === "seed") {
    const fixtureId = randomUUID();
    const result = await prisma.$transaction(async (tx) => {
      const handle = `ad-lifecycle-${fixtureId}`;
      const channel = await tx.channel.create({
        data: { handle, name: "Synthetic advertising TV" },
      });
      const tv = await tx.creatorTvChannel.create({
        data: { channelId: channel.id, slug: handle, name: "Synthetic advertising TV" },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { primaryTvChannelId: tv.id } });
      const videos = [];
      for (const label of ["first", "second"]) {
        const video = await tx.video.create({
          data: {
            channelId: channel.id,
            slug: `${handle}-${label}`,
            title: `Synthetic advertising ${label}`,
            durationMs: 120_000,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            publishedAt: new Date(),
            mediaAssets: {
              create: {
                channelId: channel.id,
                kind: "SOURCE_VIDEO",
                status: "VALIDATED",
                r2ObjectKey: `e2e/ad-lifecycle/${fixtureId}/${label}.mp4`,
                mimeType: "video/mp4",
                sizeBytes: 2048n,
                durationMs: 120_000,
              },
            },
          },
        });
        videos.push({ id: video.id, slug: video.slug, channelId: channel.id });
      }
      return { fixtureId, channelId: channel.id, handle, videos };
    });
    console.log(JSON.stringify(result));
  } else if (command === "cleanup") {
    if (!/^[0-9a-f-]{36}$/.test(input.fixtureId ?? ""))
      throw new Error("Invalid fixture identity.");
    await prisma.$transaction(async (tx) => {
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });
      if (channel.handle !== `ad-lifecycle-${input.fixtureId}`)
        throw new Error("Fixture ownership mismatch.");
      const videos = await tx.video.findMany({ where: { channelId: channel.id } });
      if (
        videos.length !== 2 ||
        videos.some((video) => !video.slug.startsWith(`${channel.handle}-`))
      )
        throw new Error("Fixture video ownership mismatch.");
      await tx.creatorTvChannel.deleteMany({ where: { channelId: channel.id } });
      await tx.video.deleteMany({ where: { channelId: channel.id } });
      await tx.channel.delete({ where: { id: channel.id } });
    });
    console.log(JSON.stringify({ cleaned: true }));
  } else {
    throw new Error("Unsupported advertising lifecycle fixture command.");
  }
} finally {
  await prisma.$disconnect();
}
