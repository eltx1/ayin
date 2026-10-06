import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname))
  throw new Error("A loopback TEST_DATABASE_URL is required.");
const prisma = createPrismaClient(databaseUrl);
const command = process.argv[2];
const input = JSON.parse(process.argv[3] ?? "{}");
try {
  if (command === "seed") {
    const run = randomUUID();
    const channel = await prisma.channel.create({
      data: { handle: `catalog-browser-${run}`, name: "Catalog browser fixture" },
    });
    async function video(title) {
      return prisma.video.create({
        data: {
          channelId: channel.id,
          title,
          slug: `catalog-${randomUUID()}`,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          durationMs: 120000,
          publishedAt: new Date(),
          mediaAssets: {
            create: {
              channelId: channel.id,
              kind: "SOURCE_VIDEO",
              status: "VALIDATED",
              r2ObjectKey: `catalog-browser/${run}/${randomUUID()}.mp4`,
              mimeType: "video/mp4",
              sizeBytes: 2048n,
            },
          },
        },
      });
    }
    const firstVideo = await video("Original pilot video");
    const nextVideo = await video("Original next video");
    const movies = [];
    for (let n = 1; n <= 110; n++) {
      const movie = await prisma.movie.create({
        data: {
          title: `Journey ${String(n).padStart(3, "0")}`,
          slug: `catalog-journey-${run}-${n}`,
          synopsis: "A catalog browser fixture.",
          releaseYear: 2026,
          runtimeMinutes: 90,
          maturityRating: "PG",
          originalLanguage: "en",
          status: "PUBLISHED",
          primaryVideoId: firstVideo.id,
          availability: { create: { territoryCode: "*", rule: "ALLOW" } },
          localizations: { create: { locale: "ar", title: `رحلة ${String(n).padStart(3, "0")}` } },
        },
      });
      movies.push(movie.id);
    }
    const series = await prisma.series.create({
      data: {
        title: "Journey series",
        slug: `catalog-series-${run}`,
        synopsis: "A series with explicit episode navigation.",
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        localizations: { create: { locale: "ar", title: "مسلسل الرحلة" } },
      },
    });
    const firstSeason = await prisma.seriesSeason.create({
      data: {
        seriesId: series.id,
        seasonNumber: 1,
        title: "Beginnings",
        localizations: { create: { locale: "ar", title: "البداية" } },
      },
    });
    const nextSeason = await prisma.seriesSeason.create({
      data: { seriesId: series.id, seasonNumber: 2, sortOrder: 1 },
    });
    await prisma.seriesEpisode.create({
      data: {
        seasonId: firstSeason.id,
        episodeNumber: 1,
        title: "First journey",
        synopsis: "The story starts here.",
        videoId: firstVideo.id,
        status: "PUBLISHED",
        localizations: {
          create: { locale: "ar", title: "الرحلة الأولى", synopsis: "تبدأ الحكاية هنا." },
        },
      },
    });
    await prisma.seriesEpisode.create({
      data: {
        seasonId: nextSeason.id,
        episodeNumber: 1,
        title: "The return",
        synopsis: "The next available episode.",
        videoId: nextVideo.id,
        status: "PUBLISHED",
        localizations: { create: { locale: "ar", title: "العودة" } },
      },
    });
    process.stdout.write(
      JSON.stringify({
        channelId: channel.id,
        movieIds: movies,
        seriesId: series.id,
        seriesSlug: series.slug,
        firstSlug: firstVideo.slug,
        nextSlug: nextVideo.slug,
        nextVideoId: nextVideo.id,
      }),
    );
  } else if (command === "block-next") {
    await prisma.video.update({
      where: { id: input.nextVideoId },
      data: { visibility: "PRIVATE" },
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "cleanup") {
    if (
      !Array.isArray(input.movieIds) ||
      input.movieIds.length !== 110 ||
      !input.channelId ||
      !input.seriesId
    )
      throw new Error("Missing owned fixture identities.");
    await prisma.$transaction(async (tx) => {
      await tx.movie.deleteMany({ where: { id: { in: input.movieIds } } });
      await tx.seriesEpisode.deleteMany({ where: { season: { seriesId: input.seriesId } } });
      await tx.seriesSeason.deleteMany({ where: { seriesId: input.seriesId } });
      await tx.series.deleteMany({ where: { id: input.seriesId } });
      await tx.mediaAsset.deleteMany({ where: { channelId: input.channelId } });
      await tx.video.deleteMany({ where: { channelId: input.channelId } });
      await tx.channel.deleteMany({ where: { id: input.channelId } });
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else throw new Error("Unknown fixture command.");
} finally {
  await prisma.$disconnect();
}
