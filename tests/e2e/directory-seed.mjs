import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated E2E database is required.");
const prisma = createPrismaClient(databaseUrl);
try {
  // This helper is only invoked with the dedicated TEST_DATABASE_URL. Existing
  // generic account reset intentionally leaves editorial catalogs intact.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Movie", "Series", "Channel" CASCADE');
  const catalog = JSON.parse(
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./catalog-seed.mjs", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" },
    ),
  );
  const movie = await prisma.movie.findUniqueOrThrow({ where: { slug: catalog.movieSlug } });
  const video = await prisma.video.findUniqueOrThrow({ where: { id: movie.primaryVideoId } });
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: video.channelId } });
  const tv = await prisma.creatorTvChannel.create({
    data: { channelId: channel.id, name: "Catalog E2E TV", slug: `catalog-tv-${randomUUID()}` },
  });
  await prisma.channel.update({ where: { id: channel.id }, data: { primaryTvChannelId: tv.id } });
  if (process.argv.includes("--more")) {
    for (let index = 1; index <= 26; index++) {
      await prisma.movie.create({
        data: {
          title: `Directory continuation ${index}`,
          slug: `directory-continuation-${randomUUID()}`,
          synopsis: "Isolated pagination fixture",
          releaseYear: 2026,
          runtimeMinutes: 90,
          maturityRating: "PG",
          originalLanguage: "en",
          status: "PUBLISHED",
          primaryVideoId: video.id,
          availability: { create: { territoryCode: "*", rule: "ALLOW" } },
        },
      });
    }
  }
  process.stdout.write(JSON.stringify({ ...catalog, channelHandle: channel.handle }));
} finally {
  await prisma.$disconnect();
}
