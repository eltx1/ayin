import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Task 58 catalog administration", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-58-catalog-test-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-58-catalog-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "Movie", "Series" CASCADE',
    );
    await prisma.adminAuditLog.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function registerOperationsAdmin() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Catalog Operations",
        email: `task58-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user as {
      account: { id: string };
      channel: { id: string; handle: string };
    };
    await prisma.adminRoleAssignment.create({
      data: { accountId: user.account.id, role: "OPERATIONS" },
    });
    const mfa = await enrollTestMfa(app, cookiePair(response.headers["set-cookie"]));
    return { cookie: mfa.cookie, user };
  }

  async function createPlayableVideo(channelId: string, title: string) {
    const suffix = randomUUID().slice(0, 8);
    const video = await prisma.video.create({
      data: {
        channelId,
        slug: `${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-${suffix}`,
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
        r2ObjectKey: `task58/${video.id}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 2048n,
        durationMs: 120_000,
        width: 1280,
        height: 720,
      },
    });
    return video;
  }

  async function createArtwork(channelId: string, name: string) {
    return prisma.mediaAsset.create({
      data: {
        channelId,
        kind: "THUMBNAIL",
        status: "VALIDATED",
        r2ObjectKey: `task58/artwork/${randomUUID()}-${name}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1024n,
        width: 1200,
        height: 1800,
      },
    });
  }

  it("publishes Movie and Series catalogs end-to-end with audited guarded mutations", async () => {
    const admin = await registerOperationsAdmin();
    const channelId = admin.user.channel.id;
    const [movieVideo, trailerVideo, episodeVideo] = await Promise.all([
      createPlayableVideo(channelId, "Task 58 Movie Feature"),
      createPlayableVideo(channelId, "Task 58 Trailer"),
      createPlayableVideo(channelId, "Task 58 Episode One"),
    ]);
    const [moviePoster, seriesPoster, seasonPoster] = await Promise.all([
      createArtwork(channelId, "movie-poster"),
      createArtwork(channelId, "series-poster"),
      createArtwork(channelId, "season-poster"),
    ]);

    const inaccessibleVideo = await prisma.video.create({
      data: {
        channelId,
        slug: `task58-private-${randomUUID().slice(0, 8)}`,
        title: "Task 58 Private Video",
        status: "PUBLISHED",
        visibility: "PRIVATE",
        durationMs: 60_000,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        channelId,
        videoId: inaccessibleVideo.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `task58/${inaccessibleVideo.id}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });

    const directory = await app.inject({
      method: "GET",
      url: "/admin/operations/directory/catalog-videos?query=Task%2058",
      headers: { cookie: admin.cookie },
    });
    expect(directory.statusCode).toBe(200);
    const directoryIds = new Set(
      (directory.json().items as Array<{ id: string }>).map((item) => item.id),
    );
    expect(directoryIds.has(movieVideo.id)).toBe(true);
    expect(directoryIds.has(episodeVideo.id)).toBe(true);
    expect(directoryIds.has(inaccessibleVideo.id)).toBe(false);

    const rejectedMovie = await app.inject({
      method: "POST",
      url: "/admin/catalog/movies",
      headers: { cookie: admin.cookie },
      payload: {
        title: "Unsafe Movie",
        synopsis: "This draft deliberately attempts an inaccessible playback assignment.",
        releaseYear: 2026,
        runtimeMinutes: 90,
        maturityRating: "PG",
        originalLanguage: "en",
        primaryVideoId: inaccessibleVideo.id,
        trailerVideoId: null,
        genres: ["Drama"],
        artwork: [
          { type: "POSTER", mediaAssetId: moviePoster.id, altText: "Unsafe Movie poster" },
        ],
        availability: [{ territoryCode: "*", rule: "ALLOW" }],
        localizations: [],
      },
    });
    expect(rejectedMovie.statusCode).toBe(400);

    const movieCreate = await app.inject({
      method: "POST",
      url: "/admin/catalog/movies",
      headers: { cookie: admin.cookie },
      payload: {
        title: "Task 58 Published Movie",
        slug: "task-58-published-movie",
        synopsis: "A complete movie catalog publishing flow for Task 58 acceptance coverage.",
        releaseYear: 2026,
        runtimeMinutes: 118,
        maturityRating: "PG-13",
        originalLanguage: "en",
        primaryVideoId: movieVideo.id,
        trailerVideoId: trailerVideo.id,
        genres: ["Drama", "Technology"],
        artwork: [
          { type: "POSTER", mediaAssetId: moviePoster.id, altText: "Task 58 movie poster" },
        ],
        availability: [{ territoryCode: "*", rule: "ALLOW" }],
        localizations: [],
      },
    });
    expect(movieCreate.statusCode).toBe(201);
    const movie = movieCreate.json().movie as {
      id: string;
      validation: { publishable: boolean };
    };
    expect(movie.validation.publishable).toBe(true);

    const moviePublish = await app.inject({
      method: "POST",
      url: `/admin/catalog/movies/${movie.id}/publish`,
      headers: { cookie: admin.cookie },
    });
    expect(moviePublish.statusCode).toBe(201);
    expect(moviePublish.json().movie.status).toBe("PUBLISHED");

    const publicMovie = await app.inject({
      method: "GET",
      url: "/public/movies/task-58-published-movie",
    });
    expect(publicMovie.statusCode).toBe(200);
    expect(publicMovie.json().movie).toMatchObject({
      title: "Task 58 Published Movie",
      slug: "task-58-published-movie",
      primaryVideo: { id: movieVideo.id },
      trailerVideo: { id: trailerVideo.id },
    });

    const orphanMovie = await app.inject({
      method: "PATCH",
      url: `/admin/catalog/movies/${movie.id}`,
      headers: { cookie: admin.cookie },
      payload: { primaryVideoId: null },
    });
    expect(orphanMovie.statusCode).toBe(409);

    const archivePublishedMovie = await app.inject({
      method: "POST",
      url: `/admin/catalog/movies/${movie.id}/archive`,
      headers: { cookie: admin.cookie },
    });
    expect(archivePublishedMovie.statusCode).toBe(409);

    const seriesCreate = await app.inject({
      method: "POST",
      url: "/admin/catalog/series",
      headers: { cookie: admin.cookie },
      payload: {
        title: "Task 58 Published Series",
        slug: "task-58-published-series",
        synopsis: "A complete Series, Season and Episode publishing flow for Task 58.",
        releaseYear: 2026,
        maturityRating: "TV-14",
        originalLanguage: "en",
        trailerVideoId: trailerVideo.id,
        genres: ["Drama", "Technology"],
        artwork: [
          { type: "POSTER", mediaAssetId: seriesPoster.id, altText: "Task 58 series poster" },
        ],
        availability: [{ territoryCode: "*", rule: "ALLOW" }],
      },
    });
    expect(seriesCreate.statusCode).toBe(201);
    const series = seriesCreate.json().series as { id: string; validation: { publishable: boolean } };
    expect(series.validation.publishable).toBe(false);

    const seasonCreate = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/${series.id}/seasons`,
      headers: { cookie: admin.cookie },
      payload: {
        seasonNumber: 1,
        title: "Launch Season",
        artwork: [
          { type: "POSTER", mediaAssetId: seasonPoster.id, altText: "Launch Season poster" },
        ],
      },
    });
    expect(seasonCreate.statusCode).toBe(201);
    const season = seasonCreate.json().season as { id: string; sortOrder: number };

    const duplicateOrder = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/${series.id}/seasons`,
      headers: { cookie: admin.cookie },
      payload: { seasonNumber: 2, sortOrder: season.sortOrder },
    });
    expect(duplicateOrder.statusCode).toBe(409);

    const rejectedEpisode = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/seasons/${season.id}/episodes`,
      headers: { cookie: admin.cookie },
      payload: {
        episodeNumber: 99,
        title: "Unsafe Episode",
        synopsis: "This episode intentionally points at inaccessible playback.",
        videoId: inaccessibleVideo.id,
      },
    });
    expect(rejectedEpisode.statusCode).toBe(400);

    const episodeCreate = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/seasons/${season.id}/episodes`,
      headers: { cookie: admin.cookie },
      payload: {
        episodeNumber: 1,
        title: "Pilot",
        synopsis: "The published pilot episode for the Task 58 catalog acceptance flow.",
        videoId: episodeVideo.id,
      },
    });
    expect(episodeCreate.statusCode).toBe(201);
    const episode = episodeCreate.json().episode as { id: string };

    const episodePublish = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/episodes/${episode.id}/publish`,
      headers: { cookie: admin.cookie },
    });
    expect(episodePublish.statusCode).toBe(201);
    expect(episodePublish.json().episode.status).toBe("PUBLISHED");

    const seriesDetail = await app.inject({
      method: "GET",
      url: `/admin/catalog/series/${series.id}`,
      headers: { cookie: admin.cookie },
    });
    expect(seriesDetail.statusCode).toBe(200);
    expect(seriesDetail.json().series.validation.publishable).toBe(true);

    const seriesPublish = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/${series.id}/publish`,
      headers: { cookie: admin.cookie },
    });
    expect(seriesPublish.statusCode).toBe(201);
    expect(seriesPublish.json().series.status).toBe("PUBLISHED");

    const publicSeries = await app.inject({
      method: "GET",
      url: "/public/series/task-58-published-series",
    });
    expect(publicSeries.statusCode).toBe(200);
    expect(publicSeries.json().series).toMatchObject({
      title: "Task 58 Published Series",
      slug: "task-58-published-series",
      trailerVideo: { id: trailerVideo.id },
    });
    expect(publicSeries.json().series.seasons[0].episodes[0]).toMatchObject({
      title: "Pilot",
      video: { id: episodeVideo.id },
    });

    const orphanSeries = await app.inject({
      method: "POST",
      url: `/admin/catalog/series/episodes/${episode.id}/unpublish`,
      headers: { cookie: admin.cookie },
    });
    expect(orphanSeries.statusCode).toBe(409);

    await expect(prisma.seriesSeason.delete({ where: { id: season.id } })).rejects.toThrow();
    await expect(prisma.series.delete({ where: { id: series.id } })).rejects.toThrow();

    const movieSearch = await app.inject({
      method: "GET",
      url: "/admin/catalog/movies?q=Published&status=PUBLISHED",
      headers: { cookie: admin.cookie },
    });
    expect(movieSearch.statusCode).toBe(200);
    expect(movieSearch.json().items).toHaveLength(1);

    const seriesSearch = await app.inject({
      method: "GET",
      url: "/admin/catalog/series?q=Technology&status=PUBLISHED",
      headers: { cookie: admin.cookie },
    });
    expect(seriesSearch.statusCode).toBe(200);
    expect(seriesSearch.json().items).toHaveLength(1);

    const auditCount = await prisma.adminAuditLog.count({
      where: {
        actorAccountId: admin.user.account.id,
        action: { startsWith: "catalog." },
      },
    });
    expect(auditCount).toBeGreaterThanOrEqual(8);
  });
});
