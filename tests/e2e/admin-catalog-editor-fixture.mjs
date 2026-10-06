import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/db/dist/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
  throw new Error("Requires isolated local ayin_e2e");
const [command, raw = "{}"] = process.argv.slice(2);
const p = JSON.parse(raw),
  db = createPrismaClient(databaseUrl);
try {
  if (typeof p.accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(p.accountId))
    throw new Error("Invalid fixture actor");
  await db.account.findUniqueOrThrow({ where: { id: p.accountId } });
  if (command === "seed") {
    await db.adminRoleAssignment.create({ data: { accountId: p.accountId, role: "OPERATIONS" } });
    const prefix = `catalog-editor-${randomUUID().slice(0, 8)}-`,
      movies = [],
      series = [];
    const poster = await db.mediaAsset.create({
      data: {
        kind: "THUMBNAIL",
        status: "VALIDATED",
        r2ObjectKey: prefix + "poster.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024n,
        width: 1200,
        height: 1800,
      },
    });
    for (let n = 0; n < 2; n++) {
      movies.push(
        await db.movie.create({
          data: {
            title: prefix + `movie-${n}`,
            slug: prefix + `movie-${n}`,
            synopsis: "Original movie synopsis",
            releaseYear: 2026,
            runtimeMinutes: 91,
            maturityRating: "PG",
            originalLanguage: "en",
            status: "DRAFT",
            artwork: {
              create: {
                type: "POSTER",
                mediaAssetId: poster.id,
                altText: "Keep authored artwork caption",
              },
            },
            genres: {
              create: {
                position: 0,
                genre: {
                  create: { name: prefix + "Movie genre " + n, slug: prefix + "movie-genre-" + n },
                },
              },
            },
            availability: {
              create: {
                territoryCode: "*",
                rule: "ALLOW",
                startsAt: new Date("2035-01-01T12:01:23.456Z"),
                note: "Preserve exact time",
              },
            },
          },
        }),
      );
      series.push(
        await db.series.create({
          data: {
            title: prefix + `series-${n}`,
            slug: prefix + `series-${n}`,
            synopsis: "Original series synopsis",
            maturityRating: "TV-14",
            originalLanguage: "en",
            status: "DRAFT",
            artwork: {
              create: {
                type: "POSTER",
                mediaAssetId: poster.id,
                altText: "Keep authored artwork caption",
              },
            },
            genres: {
              create: {
                position: 0,
                genre: {
                  create: {
                    name: prefix + "Series genre " + n,
                    slug: prefix + "series-genre-" + n,
                  },
                },
              },
            },
            seasons: {
              create: [
                {
                  seasonNumber: 1,
                  title: "First season",
                  sortOrder: 0,
                  episodes: {
                    create: [
                      {
                        episodeNumber: 1,
                        title: "First episode",
                        synopsis: "First synopsis",
                        sortOrder: 0,
                        releaseDate: new Date("2035-01-01T12:01:23.456Z"),
                      },
                      {
                        episodeNumber: 2,
                        title: "Second episode",
                        synopsis: "Second synopsis",
                        sortOrder: 1,
                      },
                    ],
                  },
                },
                { seasonNumber: 2, title: "Second season", sortOrder: 1 },
              ],
            },
          },
          include: { seasons: { include: { episodes: true }, orderBy: { sortOrder: "asc" } } },
        }),
      );
    }
    console.log(JSON.stringify({ prefix, movies, series }));
  } else {
    if (typeof p.prefix !== "string" || !/^catalog-editor-[a-f0-9]{8}-$/.test(p.prefix))
      throw new Error("Invalid fixture scope");
    if (command === "evidence") {
      const movies = await db.movie.findMany({
        where: { slug: { startsWith: p.prefix } },
        include: { artwork: true, availability: true },
      });
      const series = await db.series.findMany({
        where: { slug: { startsWith: p.prefix } },
        include: { seasons: { include: { episodes: true }, orderBy: { sortOrder: "asc" } } },
      });
      const audits = await db.adminAuditLog.findMany({
        where: { actorAccountId: p.accountId },
        orderBy: { createdAt: "asc" },
      });
      console.log(JSON.stringify({ movies, series, audits }));
    } else if (command === "change-episode") {
      const episode = await db.seriesEpisode.findUniqueOrThrow({
        where: { id: p.episodeId },
        include: { season: { include: { series: true } } },
      });
      if (!episode.season.series.slug.startsWith(p.prefix))
        throw new Error("Target outside fixture");
      const before = episode.season.series.updatedAt;
      await db.seriesEpisode.update({
        where: { id: episode.id },
        data: { title: "External episode change" },
      });
      const after = await db.series.findUniqueOrThrow({ where: { id: episode.season.seriesId } });
      console.log(JSON.stringify({ parentBefore: before, parentAfter: after.updatedAt }));
    } else if (
      command === "change-movie" ||
      command === "archive-movie" ||
      command === "delete-movie"
    ) {
      const movie = await db.movie.findUniqueOrThrow({ where: { id: p.movieId } });
      if (!movie.slug.startsWith(p.prefix)) throw new Error("Target outside fixture");
      if (command === "delete-movie") await db.movie.delete({ where: { id: movie.id } });
      else
        await db.movie.update({
          where: { id: movie.id },
          data:
            command === "archive-movie"
              ? { status: "ARCHIVED" }
              : { title: p.prefix + "external-movie-change" },
        });
      console.log(JSON.stringify({ changed: true }));
    } else if (command === "large-series") {
      const series = await db.series.findUniqueOrThrow({
        where: { id: p.seriesId },
        include: { seasons: true },
      });
      if (!series.slug.startsWith(p.prefix) || !series.seasons[0])
        throw new Error("Target outside fixture");
      await db.seriesEpisode.createMany({
        data: Array.from({ length: 54 }, (_, index) => ({
          seasonId: series.seasons[0].id,
          episodeNumber: index + 100,
          sortOrder: index + 100,
          title: `Large baseline episode ${index}`,
          synopsis: "s".repeat(20_000),
        })),
      });
      console.log(JSON.stringify({ created: 54 }));
    } else if (command === "advertising-seed") {
      await db.adminRoleAssignment.create({ data: { accountId: p.accountId, role: "AD_MANAGER" } });
      const advertiser = await db.advertiser.create({ data: { name: p.prefix + "advertiser" } });
      console.log(JSON.stringify({ advertiserId: advertiser.id }));
    } else if (command === "revoke-role") {
      await db.adminRoleAssignment.deleteMany({
        where: { accountId: p.accountId, role: "OPERATIONS" },
      });
      await db.adminRoleAssignment.create({
        data: { accountId: p.accountId, role: "FINANCE_MANAGER" },
      });
      console.log(JSON.stringify({ changed: true }));
    } else if (command === "cleanup") {
      await db.movie.deleteMany({ where: { slug: { startsWith: p.prefix } } });
      await db.seriesEpisode.deleteMany({
        where: { season: { series: { slug: { startsWith: p.prefix } } } },
      });
      await db.seriesSeason.deleteMany({ where: { series: { slug: { startsWith: p.prefix } } } });
      await db.series.deleteMany({ where: { slug: { startsWith: p.prefix } } });
      await db.mediaAsset.deleteMany({ where: { r2ObjectKey: { startsWith: p.prefix } } });
      await db.movieGenre.deleteMany({ where: { slug: { startsWith: p.prefix } } });
      await db.seriesGenre.deleteMany({ where: { slug: { startsWith: p.prefix } } });
      const advertisers = await db.advertiser.findMany({
        where: { name: { startsWith: p.prefix } },
        select: { id: true },
      });
      const campaigns = await db.campaign.findMany({
        where: { advertiserId: { in: advertisers.map((item) => item.id) } },
        select: { id: true },
      });
      await db.directCampaignConfig.deleteMany({
        where: { campaignId: { in: campaigns.map((item) => item.id) } },
      });
      await db.campaign.deleteMany({ where: { id: { in: campaigns.map((item) => item.id) } } });
      await db.advertiser.deleteMany({ where: { id: { in: advertisers.map((item) => item.id) } } });
      await db.adminAuditLog.deleteMany({ where: { actorAccountId: p.accountId } });
      await db.account.delete({ where: { id: p.accountId } });
      console.log(JSON.stringify({ cleaned: true }));
    } else throw new Error("Unknown fixture action");
  }
} finally {
  await db.$disconnect();
}
