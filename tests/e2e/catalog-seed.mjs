import { randomUUID } from "node:crypto";

import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("E2E database URL is required.");

const prisma = createPrismaClient(databaseUrl);
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function playableVideo(channelId, title, slugPrefix) {
  const video = await prisma.video.create({
    data: {
      channelId,
      slug: `${slugPrefix}-${suffix}`,
      title,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      durationMs: 120_000,
      publishedAt: new Date(Date.now() - 60_000),
    },
  });
  await prisma.mediaAsset.create({
    data: {
      channelId,
      videoId: video.id,
      kind: "SOURCE_VIDEO",
      status: "VALIDATED",
      r2ObjectKey: `e2e/catalog/${video.id}/source.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 2048n,
      durationMs: 120_000,
      width: 1280,
      height: 720,
    },
  });
  return video;
}

async function artwork(channelId, label) {
  return prisma.mediaAsset.create({
    data: {
      channelId,
      kind: "THUMBNAIL",
      status: "VALIDATED",
      r2ObjectKey: `e2e/catalog/${suffix}/${label}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1024n,
      width: 1200,
      height: 1800,
    },
  });
}

try {
  const channel = await prisma.channel.create({
    data: {
      handle: `catalog-e2e-${suffix}`.slice(0, 80),
      name: "Catalog E2E Studio",
      status: "ACTIVE",
      isPlatformOwned: true,
    },
  });
  const [movieVideo, trailerVideo, episodeVideo] = await Promise.all([
    playableVideo(channel.id, "Catalog E2E Feature", "catalog-e2e-feature"),
    playableVideo(channel.id, "Catalog E2E Trailer", "catalog-e2e-trailer"),
    playableVideo(channel.id, "Catalog E2E Pilot Video", "catalog-e2e-pilot-video"),
  ]);
  const [moviePoster, seriesPoster] = await Promise.all([
    artwork(channel.id, "movie-poster"),
    artwork(channel.id, "series-poster"),
  ]);

  const movieSlug = `catalog-e2e-movie-${suffix}`;
  const movieGenre = await prisma.movieGenre.upsert({
    where: { name: "E2E Drama" },
    update: {},
    create: { slug: `e2e-drama-${randomUUID().slice(0, 8)}`, name: "E2E Drama" },
  });
  const movie = await prisma.movie.create({
    data: {
      title: "Catalog E2E Published Movie",
      slug: movieSlug,
      synopsis: "A published movie proving the Task 58 catalog reaches the viewer experience.",
      releaseYear: 2026,
      runtimeMinutes: 118,
      maturityRating: "PG-13",
      originalLanguage: "en",
      status: "PUBLISHED",
      primaryVideoId: movieVideo.id,
      trailerVideoId: trailerVideo.id,
      publishedAt: new Date(),
    },
  });
  await prisma.movieGenreAssignment.create({
    data: { movieId: movie.id, genreId: movieGenre.id, position: 0 },
  });
  await prisma.movieArtwork.create({
    data: {
      movieId: movie.id,
      mediaAssetId: moviePoster.id,
      type: "POSTER",
      altText: "Catalog E2E Published Movie poster",
    },
  });
  await prisma.movieAvailability.create({
    data: { movieId: movie.id, territoryCode: "*", rule: "ALLOW" },
  });

  const seriesSlug = `catalog-e2e-series-${suffix}`;
  const seriesGenre = await prisma.seriesGenre.upsert({
    where: { name: "E2E Technology" },
    update: {},
    create: { slug: `e2e-technology-${randomUUID().slice(0, 8)}`, name: "E2E Technology" },
  });
  const series = await prisma.series.create({
    data: {
      title: "Catalog E2E Published Series",
      slug: seriesSlug,
      synopsis:
        "A published Series with a Season and playable Episode for Task 58 browser acceptance.",
      releaseYear: 2026,
      maturityRating: "TV-14",
      originalLanguage: "en",
      status: "PUBLISHED",
      trailerVideoId: trailerVideo.id,
      publishedAt: new Date(),
    },
  });
  await prisma.seriesGenreAssignment.create({
    data: { seriesId: series.id, genreId: seriesGenre.id, position: 0 },
  });
  await prisma.seriesArtwork.create({
    data: {
      seriesId: series.id,
      mediaAssetId: seriesPoster.id,
      type: "POSTER",
      altText: "Catalog E2E Published Series poster",
    },
  });
  await prisma.seriesAvailability.create({
    data: { seriesId: series.id, territoryCode: "*", rule: "ALLOW" },
  });
  const season = await prisma.seriesSeason.create({
    data: { seriesId: series.id, seasonNumber: 1, title: "Launch Season", sortOrder: 0 },
  });
  await prisma.seriesEpisode.create({
    data: {
      seasonId: season.id,
      episodeNumber: 1,
      title: "Pilot",
      synopsis: "The first published episode in the Task 58 browser acceptance catalog.",
      sortOrder: 0,
      status: "PUBLISHED",
      videoId: episodeVideo.id,
      publishedAt: new Date(),
    },
  });

  process.stdout.write(
    JSON.stringify({
      movieSlug,
      seriesSlug,
      movieVideoSlug: movieVideo.slug,
      trailerVideoSlug: trailerVideo.slug,
      episodeVideoSlug: episodeVideo.slug,
    }),
  );
} finally {
  await prisma.$disconnect();
}
