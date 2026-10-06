import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogLocalizationService } from "../src/catalog-localization/catalog-localization.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { MovieCatalogService } from "../src/movie-catalog/movie-catalog.service.js";
import { SeriesCatalogService } from "../src/series-catalog/series-catalog.service.js";
import { VideoPolicyService } from "../src/video-policy/video-policy.service.js";
import { LanguageAwarePostgresSearchService } from "../src/search/language-aware-postgres-search.service.js";
import { SearchLanguageContextService } from "../src/search/search-language-context.service.js";
import { SearchService } from "../src/search/search.service.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseDescribe("localized catalog global search", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  let operations = 0;
  const measured = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        operations += 1;
        return query(args);
      },
    },
  });
  const database = { client: measured } as unknown as DatabaseService;
  const policy = new VideoPolicyService(database);
  const language = new SearchLanguageContextService();
  const postgres = new LanguageAwarePostgresSearchService(database, language);
  const movies = new MovieCatalogService(database, policy, {} as never);
  const series = new SeriesCatalogService(database, policy, {} as never);
  const localization = new CatalogLocalizationService(database, {} as never);
  const search = new SearchService(
    database,
    postgres,
    series,
    movies,
    policy,
    localization,
    language,
  );
  const run = (query: string, cursor?: string, locale = "ar") =>
    language.run(locale, "search", () => search.search(query, cursor, 24, { countryCode: "JP" }));

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Movie", "Series", "Channel", "Account" CASCADE',
    );
    operations = 0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function source() {
    const channel = await prisma.channel.create({
      data: { name: "Search fixture", handle: `catalog-search-${randomUUID()}` },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Playback fixture",
        slug: `playback-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        mediaAssets: {
          create: {
            channelId: channel.id,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            sizeBytes: 2048n,
            r2ObjectKey: `catalog-search/${randomUUID()}.mp4`,
          },
        },
      },
    });
    return { channel, video };
  }
  async function movie(videoId: string, title: string, territory = "*") {
    return prisma.movie.create({
      data: {
        title,
        slug: `film-${randomUUID()}`,
        synopsis: "Original editorial copy",
        releaseYear: 2026,
        runtimeMinutes: 90,
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        primaryVideoId: videoId,
        availability: { create: { territoryCode: territory, rule: "ALLOW" } },
      },
    });
  }
  async function show(videoId: string, title: string, territory = "*") {
    return prisma.series.create({
      data: {
        title,
        slug: `series-${randomUUID()}`,
        synopsis: "Original editorial copy",
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        availability: { create: { territoryCode: territory, rule: "ALLOW" } },
        seasons: {
          create: {
            seasonNumber: 1,
            episodes: {
              create: {
                episodeNumber: 1,
                title: "Pilot",
                synopsis: "Pilot",
                videoId,
                status: "PUBLISHED",
              },
            },
          },
        },
      },
    });
  }
  it("presents localized catalog titles/artwork and synopsis-only matches through the active language-aware service", async () => {
    const { channel, video } = await source();
    const film = await movie(video.id, "Original movie");
    const program = await show(video.id, "Original series");
    const synopsisFilm = await movie(video.id, "Original synopsis movie");
    await prisma.movieLocalization.create({
      data: { movieId: synopsisFilm.id, locale: "ar", title: null, shortDescription: "رحلة النور" },
    });
    const art = await prisma.mediaAsset.create({
      data: {
        channelId: channel.id,
        kind: "THUMBNAIL",
        status: "VALIDATED",
        mimeType: "image/png",
        sizeBytes: 2048n,
        r2ObjectKey: `catalog-search/${randomUUID()}.png`,
      },
    });
    await prisma.movieLocalization.create({
      data: { movieId: film.id, locale: "ar", title: "رحلة النور", posterMediaAssetId: art.id },
    });
    await prisma.seriesLocalization.create({
      data: { seriesId: program.id, locale: "ar", title: null, synopsis: "رحلة النور" },
    });
    const result = await run("رحلة النور");
    expect(result.items.find((item) => item.id === synopsisFilm.id)?.title).toBe(
      "Original synopsis movie",
    );
    expect(result.items.find((item) => item.id === film.id)).toMatchObject({
      title: "رحلة النور",
      artworkObjectKey: art.r2ObjectKey,
    });
    expect(result.items.find((item) => item.id === program.id)).toMatchObject({
      title: "Original series",
      meta: "١ حلقة",
    });
    const suggestions = await language.run("ar", "suggest", () =>
      search.suggest("رحلة النور", 8, { countryCode: "JP" }),
    );
    expect(suggestions.suggestions.find((item) => item.id === film.id)?.label).toBe("رحلة النور");
    expect(
      (await run("رحلة النور", undefined, "en")).items.find((item) => item.id === film.id)?.title,
    ).toBe("Original movie");
  });
  it.each(["MOVIE", "SERIES"] as const)(
    "pages every %s match in a stable finite window beyond 100 with batched hydration",
    async (kind) => {
      const { video } = await source();
      const expected = new Set<string>();
      for (let index = 0; index < 110; index++) {
        const item =
          kind === "MOVIE"
            ? await movie(video.id, `Film ${index}`)
            : await show(video.id, `Program ${index}`);
        const copy = { locale: "ar", title: `رحلات النور ${String(index).padStart(3, "0")}` };
        if (kind === "MOVIE")
          await prisma.movieLocalization.create({ data: { movieId: item.id, ...copy } });
        else await prisma.seriesLocalization.create({ data: { seriesId: item.id, ...copy } });
        expected.add(item.id);
      }
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        operations = 0;
        const result = await run("رحلات النور", cursor);
        // Logical Prisma/SQL API operations remain independent of the number of matches.
        expect(operations).toBeLessThanOrEqual(24);
        for (const item of result.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
        }
        cursor = result.nextCursor ?? undefined;
        expect(seen.size).toBeLessThanOrEqual(110);
      } while (cursor);
      expect(seen).toEqual(expected);
    },
  );
  it("deduplicates localized entity rows before the language candidate limit", async () => {
    const { video } = await source();
    const expected: string[] = [];
    for (let index = 0; index < 8; index++) {
      const film = await movie(video.id, `Unrelated ${index}`);
      expected.push(film.id);
      await prisma.movieLocalization.createMany({
        data: ["fr", "es", "it", "de", "pt", "nl"].map((locale) => ({
          movieId: film.id,
          locale,
          title: "Localized Star",
        })),
      });
    }
    const candidates = await language.run("en", "search", () =>
      postgres.searchCandidates("Localized Star", 4, { countryCode: "JP" }),
    );
    expect(
      candidates
        .filter((candidate) => candidate.type === "MOVIE")
        .map((item) => item.id)
        .sort(),
    ).toEqual(expected.sort());
  });
  it("filters catalog and video eligibility before blocked high-ranked candidates fill a window", async () => {
    const { video } = await source();
    for (let index = 0; index < 210; index++) {
      await movie(video.id, "Aurora", "DE");
      await show(video.id, "Aurora", "DE");
    }
    const film = await movie(video.id, "Aurora journey");
    const program = await show(video.id, "Aurora journey");
    const result = await run("Aurora");
    expect(result.items.map((item) => item.id).sort()).toEqual([film.id, program.id].sort());
    const actor = await prisma.account.create({
      data: { email: "search-policy@e2e.ayin.test", displayName: "Search policy fixture" },
    });
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: video.id,
        disposition: "FORCE_ALLOW",
        actorAccountId: actor.id,
        reason: "Verify hard publication boundaries",
      },
    });
    await prisma.video.update({ where: { id: video.id }, data: { visibility: "PRIVATE" } });
    expect((await run("Aurora")).items).toEqual([]);
    await prisma.video.update({ where: { id: video.id }, data: { visibility: "PUBLIC" } });
    await prisma.seriesEpisode.updateMany({
      where: { season: { seriesId: program.id } },
      data: { releaseDate: new Date(Date.now() + 86400000) },
    });
    expect((await run("Aurora")).items.map((item) => item.id)).toEqual([film.id]);
    await prisma.mediaAsset.updateMany({
      where: { videoId: video.id },
      data: { status: "REJECTED" },
    });
    expect((await run("Aurora")).items).toEqual([]);
  });
  it("keeps Kids catalog types suppressed and rechecks newly blocked rights during batch hydration", async () => {
    const { video } = await source();
    const film = await movie(video.id, "Aurora");
    const program = await show(video.id, "Aurora");
    expect(
      (
        await language.run("en", "kids-search", () =>
          search.search("Aurora", undefined, 24, { countryCode: "JP", isKidsProfile: true }),
        )
      ).items,
    ).toEqual([]);
    await prisma.movieAvailability.create({
      data: { movieId: film.id, territoryCode: "JP", rule: "BLOCK" },
    });
    await prisma.seriesAvailability.create({
      data: { seriesId: program.id, territoryCode: "JP", rule: "BLOCK" },
    });
    expect(await movies.getPublicSearchCards([film.id], "JP")).toEqual([]);
    expect(await series.getPublicSearchCards([program.id], "JP")).toEqual([]);
  });
});
