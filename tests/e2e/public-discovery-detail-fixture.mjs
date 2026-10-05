import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../../packages/db/dist/index.js";

// This fixture never uses DATABASE_URL as a fallback. All writes are scoped to
// an explicit test database and cleanup restores the previous merchandising.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("An isolated TEST_DATABASE_URL is required.");
const prisma = createPrismaClient(databaseUrl);
const command = process.argv[2];
const input = JSON.parse(process.argv[3] ?? "{}");
const where = { namespace_key: { namespace: "DISCOVERY", key: "productControls" } };
try {
  if (command === "seed") {
    const previous = await prisma.platformSetting.findUnique({ where });
    const catalog = JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("./catalog-seed.mjs", import.meta.url))],
        { env: process.env, encoding: "utf8" },
      ),
    );
    const movie = await prisma.movie.findUniqueOrThrow({ where: { slug: catalog.movieSlug } });
    const series = await prisma.series.findUniqueOrThrow({ where: { slug: catalog.seriesSlug } });
    const video = await prisma.video.findUniqueOrThrow({ where: { id: movie.primaryVideoId } });
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: video.channelId } });
    const longTitle =
      "Creator’s original story · حكاية من صانع المحتوى · " +
      "A journey worth watching together ".repeat(3);
    await prisma.video.update({
      where: { id: video.id },
      data: { title: longTitle, description: null },
    });
    await prisma.movie.update({
      where: { id: movie.id },
      data: { synopsis: "Original editorial synopsis. ".repeat(12) },
    });
    await prisma.series.update({
      where: { id: series.id },
      data: { synopsis: "Original series synopsis. ".repeat(12) },
    });
    await prisma.seriesSeason.updateMany({ where: { seriesId: series.id }, data: { title: null } });
    const secondSeason = await prisma.seriesSeason.create({
      data: {
        seriesId: series.id,
        seasonNumber: 2,
        title: "Creator’s own season title",
        sortOrder: 1,
      },
    });
    await prisma.seriesEpisode.create({
      data: {
        seasonId: secondSeason.id,
        episodeNumber: 1,
        title: "Second season premiere",
        synopsis: "Original creator episode description",
        status: "PUBLISHED",
        sortOrder: 0,
        videoId: video.id,
        publishedAt: new Date(),
      },
    });
    const tv = await prisma.creatorTvChannel.create({
      data: {
        channelId: channel.id,
        name: "Discovery fixture TV",
        slug: `discovery-${channel.handle}`,
      },
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: { primaryTvChannelId: tv.id, description: null },
    });
    const playlist = await prisma.playlist.create({
      data: {
        channelId: channel.id,
        name: "Discovery fixture playlist",
        slug: "discovery-fixture",
        visibility: "PUBLIC",
        isPublic: true,
        items: { create: { videoId: video.id, position: 0 } },
      },
    });
    const controls = previous?.value ?? {
      navigation: [
        { key: "home", label: "Home", href: "/", enabled: true, featureFlag: null },
        { key: "search", label: "Search", href: "/search", enabled: true, featureFlag: null },
      ],
      hero: { entityType: null, entityId: null },
      taxonomy: [],
      announcement: { enabled: false, text: "", href: null },
      deviceVisibility: { web: true, mobile: true, tv: true },
    };
    await prisma.platformSetting.upsert({
      where,
      create: {
        namespace: "DISCOVERY",
        key: "productControls",
        valueType: "JSON",
        value: controls,
      },
      update: { value: controls },
    });
    process.stdout.write(
      JSON.stringify({
        ...catalog,
        movieId: movie.id,
        seriesId: series.id,
        channelId: channel.id,
        channelHandle: channel.handle,
        videoId: video.id,
        tvId: tv.id,
        playlistId: playlist.id,
        playlistSlug: playlist.slug,
        longTitle,
        previousControls: previous?.value ?? null,
      }),
    );
  } else if (command === "hero") {
    const setting = await prisma.platformSetting.findUniqueOrThrow({ where });
    await prisma.platformSetting.update({
      where,
      data: {
        value: {
          ...setting.value,
          hero: { entityType: input.entityType ?? null, entityId: input.entityId ?? null },
        },
      },
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else if (command === "cleanup") {
    for (const key of ["movieId", "seriesId", "channelId", "tvId"]) {
      if (typeof input[key] !== "string" || !/^[0-9a-f-]{36}$/i.test(input[key]))
        throw new Error(`Missing cleanup identity: ${key}`);
    }
    await prisma.$transaction(async (tx) => {
      if (input.previousControls)
        await tx.platformSetting.update({ where, data: { value: input.previousControls } });
      else
        await tx.platformSetting.deleteMany({
          where: { namespace: "DISCOVERY", key: "productControls" },
        });
      await tx.movie.deleteMany({ where: { id: input.movieId } });
      await tx.seriesEpisode.deleteMany({ where: { season: { seriesId: input.seriesId } } });
      await tx.seriesSeason.deleteMany({ where: { seriesId: input.seriesId } });
      await tx.series.deleteMany({ where: { id: input.seriesId } });
      await tx.tvScheduleItem.deleteMany({ where: { tvChannelId: input.tvId } });
      await tx.playlistItem.deleteMany({ where: { playlist: { channelId: input.channelId } } });
      await tx.mediaAsset.deleteMany({ where: { channelId: input.channelId } });
      await tx.video.deleteMany({ where: { channelId: input.channelId } });
      await tx.channel.deleteMany({ where: { id: input.channelId } });
    });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else throw new Error("Unknown fixture command");
} finally {
  await prisma.$disconnect();
}
