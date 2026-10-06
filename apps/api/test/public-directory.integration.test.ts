import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { catalogAvailabilitySql } from "../src/video-policy/catalog-directory-query.js";
import { isMovieAvailableInTerritory } from "../src/movie-catalog/movie-catalog.policy.js";

const url = process.env.TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
databaseDescribe("Web/PWA public directories", () => {
  const prisma = createPrismaClient(url);
  let app: NestFastifyApplication;
  const env = {
    token: process.env.AYIN_INTERNAL_EDGE_TOKEN,
    trust: process.env.AYIN_TRUST_CLOUDFLARE_REGION,
  };
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = url;
    process.env.AUTH_TOKEN_SECRET = "directory-auth-test-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "directory-upload-test-secret-with-more-than-32-characters";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = "directory-fixture-edge-token";
    process.env.AYIN_TRUST_CLOUDFLARE_REGION = "false";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "Movie", "Series" CASCADE',
    );
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    if (env.token === undefined) delete process.env.AYIN_INTERNAL_EDGE_TOKEN;
    else process.env.AYIN_INTERNAL_EDGE_TOKEN = env.token;
    if (env.trust === undefined) delete process.env.AYIN_TRUST_CLOUDFLARE_REGION;
    else process.env.AYIN_TRUST_CLOUDFLARE_REGION = env.trust;
  });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const headers = {
    "x-ayin-edge-country": "JP",
    "x-ayin-edge-token": "directory-fixture-edge-token",
  };
  async function channel(n = 1) {
    return prisma.channel.create({
      data: { id: id(n), name: `Creator ${n}`, handle: `directory-${n}` },
    });
  }
  async function policyActor() {
    return prisma.account.create({
      data: { email: "directory-policy@example.test", displayName: "Directory policy fixture" },
    });
  }
  async function video(channelId: string) {
    return prisma.video.create({
      data: {
        channelId,
        title: "Directory video",
        slug: `directory-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(Date.now() - 60_000),
        mediaAssets: {
          create: {
            channelId,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            r2ObjectKey: `directory/${randomUUID()}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: 2048n,
          },
        },
      },
    });
  }
  async function movie(n: number, videoId: string, territory = "*") {
    return prisma.movie.create({
      data: {
        id: id(n),
        title: `Film ${n}`,
        slug: `film-${n}`,
        synopsis: "A real test catalog title.",
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
  async function series(n: number, videoId: string, territory?: string) {
    return prisma.series.create({
      data: {
        id: id(n),
        title: `Series ${n}`,
        slug: `series-${n}`,
        synopsis: "A real test catalog series.",
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        ...(territory
          ? { availability: { create: { territoryCode: territory, rule: "ALLOW" } } }
          : {}),
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
  it("filters rights before pagination, localizes and traverses beyond old capped pages", async () => {
    const c = await channel();
    const v = await video(c.id);
    for (let n = 1; n <= 83; n++) await movie(n, v.id, n <= 3 ? "DE" : "*");
    await prisma.movieLocalization.create({
      data: { movieId: id(4), locale: "ar", title: "فيلم للاختبار" },
    });
    const first = await app.inject({ url: "/public/movies/directory?limit=2&locale=ar", headers });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual([id(4), id(5)]);
    expect(first.json().items[0].title).toBe("فيلم للاختبار");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pageUrl: string = `/public/movies/directory?limit=7${cursor ? `&cursor=${cursor}` : ""}`;
      const response = await app.inject({ url: pageUrl, headers });
      expect(response.statusCode).toBe(200);
      seen.push(...response.json().items.map((item: { id: string }) => item.id));
      cursor = response.json().nextCursor;
      expect(seen.length).toBeLessThanOrEqual(80);
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 80 }, (_, i) => id(i + 4)));
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("searches localized catalog copy before paging beyond 100 titles", async () => {
    const c = await channel();
    const v = await video(c.id);
    for (let n = 1; n <= 113; n++) {
      await movie(n, v.id, n <= 3 ? "DE" : "*");
      await series(n, v.id, n <= 3 ? "DE" : "*");
    }
    await prisma.movieLocalization.createMany({
      data: Array.from({ length: 113 }, (_, i) => ({
        movieId: id(i + 1),
        locale: "ar",
        title: `رحلة ${i + 1}`,
      })),
    });
    await prisma.seriesLocalization.createMany({
      data: Array.from({ length: 113 }, (_, i) => ({
        seriesId: id(i + 1),
        locale: "ar",
        title: `رحلة ${i + 1}`,
      })),
    });
    for (const kind of ["movies", "series"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ locale: "ar", q: "رحلة", limit: "24" });
        if (cursor) params.set("cursor", cursor);
        const response = await app.inject({ url: `/public/${kind}/directory?${params}`, headers });
        expect(response.statusCode).toBe(200);
        const page = response.json();
        expect(page.items.every((item: { title: string }) => item.title.startsWith("رحلة"))).toBe(
          true,
        );
        seen.push(...page.items.map((item: { id: string }) => item.id));
        cursor = page.nextCursor;
        expect(seen.length).toBeLessThanOrEqual(110);
      } while (cursor);
      expect(seen).toEqual(Array.from({ length: 110 }, (_, i) => id(i + 4)));
      const english = await app.inject({
        url: `/public/${kind}/directory?locale=en&q=${encodeURIComponent("رحلة")}`,
        headers,
      });
      expect(english.json()).toEqual({ items: [], nextCursor: null });
      const original = await app.inject({
        url: `/public/${kind}/directory?locale=ar&q=${kind === "movies" ? "Film" : "Series"}%20113`,
        headers,
      });
      expect(original.json().items.map((item: { id: string }) => item.id)).toEqual([id(113)]);
    }
  });
  it("treats search wildcards literally and does not return blocked translated titles", async () => {
    const c = await channel();
    const v = await video(c.id);
    for (const n of [1, 2, 3]) {
      await movie(n, v.id, n === 1 ? "DE" : "*");
      await series(n, v.id, n === 1 ? "DE" : "*");
    }
    await prisma.movieLocalization.createMany({
      data: [1, 2].map((n) => ({ movieId: id(n), locale: "en", title: "Literal 100%_match" })),
    });
    await prisma.seriesLocalization.createMany({
      data: [1, 2].map((n) => ({ seriesId: id(n), locale: "en", title: "Literal 100%_match" })),
    });
    for (const kind of ["movies", "series"]) {
      const response = await app.inject({
        url: `/public/${kind}/directory?locale=ar&q=${encodeURIComponent("%_")}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([id(2)]);
      expect(response.json().nextCursor).toBeNull();
      const injection = await app.inject({
        url: `/public/${kind}/directory?q=${encodeURIComponent("' OR TRUE --")}`,
        headers,
      });
      expect(injection.json()).toEqual({ items: [], nextCursor: null });
    }
  });
  it("localizes Watch episode context and advances only through eligible published episodes", async () => {
    const c = await channel();
    const current = await video(c.id);
    await series(1, current.id);
    const season = await prisma.seriesSeason.findFirstOrThrow({ where: { seriesId: id(1) } });
    const first = await prisma.seriesEpisode.findFirstOrThrow({ where: { seasonId: season.id } });
    const nextVideo = await video(c.id);
    const futureVideo = await video(c.id);
    const privateVideo = await video(c.id);
    await prisma.video.update({ where: { id: privateVideo.id }, data: { visibility: "PRIVATE" } });
    await prisma.seriesEpisode.createMany({
      data: [
        {
          seasonId: season.id,
          episodeNumber: 2,
          title: "Future",
          synopsis: "Future",
          videoId: futureVideo.id,
          status: "PUBLISHED",
          sortOrder: 1,
          releaseDate: new Date(Date.now() + 86_400_000),
        },
        {
          seasonId: season.id,
          episodeNumber: 3,
          title: "Private",
          synopsis: "Private",
          videoId: privateVideo.id,
          status: "PUBLISHED",
          sortOrder: 2,
        },
      ],
    });
    const nextSeason = await prisma.seriesSeason.create({
      data: { seriesId: id(1), seasonNumber: 2, sortOrder: 1 },
    });
    const next = await prisma.seriesEpisode.create({
      data: {
        seasonId: nextSeason.id,
        episodeNumber: 1,
        title: "Next season",
        synopsis: "Next episode",
        videoId: nextVideo.id,
        status: "PUBLISHED",
      },
    });
    await prisma.seriesLocalization.create({
      data: { seriesId: id(1), locale: "ar", title: "المسلسل" },
    });
    await prisma.seriesSeasonLocalization.create({
      data: { seasonId: season.id, locale: "ar", title: "البداية" },
    });
    await prisma.seriesEpisodeLocalization.createMany({
      data: [
        { episodeId: first.id, locale: "ar", title: "الحلقة الأولى", synopsis: "وصف البداية" },
        { episodeId: next.id, locale: "ar", title: "عودة القصة" },
      ],
    });
    const response = await app.inject({
      url: `/public/videos/${current.slug}/playback?locale=ar`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().detail).toMatchObject({
      contentType: "SERIES_EPISODE",
      seriesContext: {
        series: { title: "المسلسل" },
        season: { title: "البداية" },
        episode: { title: "الحلقة الأولى", synopsis: "وصف البداية" },
      },
      nextEpisode: {
        id: next.id,
        title: "عودة القصة",
        seasonNumber: 2,
        video: { id: nextVideo.id },
      },
    });
    const last = await app.inject({
      url: `/public/videos/${nextVideo.slug}/playback?locale=en`,
      headers,
    });
    expect(last.json().detail.seriesContext.nextEpisode).toBeNull();
    await prisma.seriesAvailability.create({
      data: { seriesId: id(1), territoryCode: "JP", rule: "BLOCK" },
    });
    const blocked = await app.inject({
      url: `/public/videos/${current.slug}/playback?locale=ar`,
      headers,
    });
    expect(blocked.json().detail).toMatchObject({
      contentType: "CREATOR_VIDEO",
      seriesContext: null,
      nextEpisode: null,
    });
  });
  it("returns a deliberate 400 for malformed playback locales on series episodes", async () => {
    const c = await channel();
    const v = await video(c.id);
    await series(1, v.id);
    for (const query of [
      "locale=ar&locale=en",
      "locale[name]=ar",
      "locale[]=ar",
      `locale=${"a".repeat(36)}`,
      "locale=",
    ]) {
      const response = await app.inject({
        url: `/public/videos/${v.slug}/playback?${query}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_PLAYBACK_QUERY");
    }
    expect(
      (await app.inject({ url: `/public/videos/${v.slug}/playback?locale=ar`, headers }))
        .statusCode,
    ).toBe(200);
    // This ordinary fixture is not Kids eligible; the validated query retains the Kids policy gate.
    expect(
      (await app.inject({ url: `/public/videos/${v.slug}/playback?locale=ar&kids=1`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it("retains exact-region precedence, wildcard/expired policy and unknown-region behavior", async () => {
    const c = await channel();
    const v = await video(c.id);
    await movie(1, v.id);
    await movie(2, v.id, "JP");
    await movie(3, v.id);
    await prisma.movieAvailability.create({
      data: { movieId: id(1), territoryCode: "JP", rule: "BLOCK" },
    });
    await prisma.movieAvailability.updateMany({
      where: { movieId: id(3) },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    const known = await app.inject({ url: "/public/movies/directory", headers });
    expect(known.json().items.map((item: { id: string }) => item.id)).toEqual([id(2)]);
    const unknown = await app.inject({
      url: "/public/movies/directory",
      headers: { "x-ayin-edge-country": "JP", "cf-ipcountry": "JP" },
    });
    expect(unknown.json().items.map((item: { id: string }) => item.id)).toEqual([id(1)]);
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: v.id,
        disposition: "FORCE_BLOCK",
        actorAccountId: (await policyActor()).id,
        reason: "directory fixture",
      },
    });
    expect((await app.inject({ url: "/public/movies/directory", headers })).json().items).toEqual(
      [],
    );
  });
  it("never lists private, removed or unplayable videos even under force-allow", async () => {
    const c = await channel();
    const v = await video(c.id);
    await movie(1, v.id);
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: v.id,
        disposition: "FORCE_ALLOW",
        actorAccountId: (await policyActor()).id,
        reason: "directory fixture",
      },
    });
    await prisma.video.update({ where: { id: v.id }, data: { visibility: "PRIVATE" } });
    expect((await app.inject({ url: "/public/movies/directory" })).json().items).toEqual([]);
    await prisma.video.update({
      where: { id: v.id },
      data: { visibility: "PUBLIC", removedAt: new Date() },
    });
    expect((await app.inject({ url: "/public/movies/directory" })).json().items).toEqual([]);
    await prisma.video.update({ where: { id: v.id }, data: { removedAt: null } });
    await prisma.mediaAsset.updateMany({ where: { videoId: v.id }, data: { status: "REJECTED" } });
    expect((await app.inject({ url: "/public/movies/directory" })).json().items).toEqual([]);
  });
  it("series retain legacy global availability but omit blocked, future and private episodes", async () => {
    const c = await channel();
    const v = await video(c.id);
    await series(1, v.id, "DE");
    await series(2, v.id);
    await series(3, v.id, "*");
    await prisma.seriesEpisode.updateMany({
      where: { season: { seriesId: id(3) } },
      data: { releaseDate: new Date(Date.now() + 86_400_000) },
    });
    const response = await app.inject({ url: "/public/series/directory?limit=1", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([id(2)]);
    expect(response.json().items[0]).not.toHaveProperty("seasons");
    expect(response.json().nextCursor).toBeNull();
    await prisma.video.update({ where: { id: v.id }, data: { visibility: "PRIVATE" } });
    expect((await app.inject({ url: "/public/series/directory", headers })).json().items).toEqual(
      [],
    );
  });
  it("catalog SQL matches territorial decisions at inclusive starts and exclusive ends", async () => {
    const c = await channel();
    const v = await video(c.id);
    await movie(1, v.id);
    await series(1, v.id);
    const now = new Date("2026-01-15T12:00:00.000Z");
    type Rule = {
      territoryCode: string;
      rule: "ALLOW" | "BLOCK";
      startsAt: Date | null;
      endsAt: Date | null;
    };
    const allow = (
      territoryCode: string,
      startsAt: Date | null = null,
      endsAt: Date | null = null,
    ): Rule => ({ territoryCode, rule: "ALLOW", startsAt, endsAt });
    const block = (territoryCode: string): Rule => ({ ...allow(territoryCode), rule: "BLOCK" });
    const fixtures: Rule[][] = [
      [],
      [allow("*")],
      [block("*")],
      [allow("*"), block("JP")],
      [block("*"), allow("JP")],
      [allow("JP"), block("JP")],
      [allow("*", now)],
      [allow("*", null, now)],
      [allow("*", new Date(now.getTime() + 1))],
      [allow("*"), { ...block("JP"), endsAt: now }],
      [allow("*", null, new Date(now.getTime() + 1))],
      [allow("DE"), allow("JP", now)],
    ];
    for (const rules of fixtures) {
      await prisma.movieAvailability.deleteMany({ where: { movieId: id(1) } });
      await prisma.seriesAvailability.deleteMany({ where: { seriesId: id(1) } });
      if (rules.length) {
        await prisma.movieAvailability.createMany({
          data: rules.map((rule) => ({ movieId: id(1), ...rule })),
        });
        await prisma.seriesAvailability.createMany({
          data: rules.map((rule) => ({ seriesId: id(1), ...rule })),
        });
      }
      for (const country of [undefined, "JP", "DE", "BR"]) {
        const [actual] = await prisma.$queryRaw<
          Array<{ movie: boolean; series: boolean }>
        >(Prisma.sql`
          SELECT ${catalogAvailabilitySql("MOVIE", Prisma.sql`${id(1)}::uuid`, country, now)} AS movie,
                 ${catalogAvailabilitySql("SERIES", Prisma.sql`${id(1)}::uuid`, country, now)} AS series
        `);
        const expected = isMovieAvailableInTerritory(rules, country, now);
        expect(actual).toEqual({ movie: expected, series: rules.length === 0 || expected });
      }
    }
  });
  it("creator TV lists the correct active primary, never secondary or invalid-owner output", async () => {
    const c = await channel(1);
    const other = await channel(2);
    await channel(3);
    const [primary, secondary] = await Promise.all([
      prisma.creatorTvChannel.create({
        data: { channelId: c.id, name: "Primary TV", slug: "primary-tv" },
      }),
      prisma.creatorTvChannel.create({
        data: { channelId: c.id, name: "Secondary TV", slug: "secondary-tv" },
      }),
    ]);
    await prisma.channel.update({ where: { id: c.id }, data: { primaryTvChannelId: primary.id } });
    await prisma.channel.update({
      where: { id: other.id },
      data: { primaryTvChannelId: secondary.id },
    });
    const response = await app.inject({ url: "/public/discovery/tv" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      title: "Primary TV",
      href: "/c/directory-1/tv",
    });
    expect(response.json().items[0]).not.toHaveProperty("providerResourceId");
    await prisma.creatorTvChannel.update({
      where: { id: primary.id },
      data: { disabledAt: new Date() },
    });
    expect((await app.inject({ url: "/public/discovery/tv" })).json().items).toEqual([]);
    await prisma.channel.update({ where: { id: other.id }, data: { removedAt: new Date() } });
    const creators = await app.inject({ url: "/public/discovery/creators?limit=1" });
    expect(creators.json().items[0].id).toBe(c.id);
    const more = await app.inject({
      url: `/public/discovery/creators?cursor=${creators.json().nextCursor}`,
    });
    expect(more.json().items.map((item: { id: string }) => item.id)).toEqual([id(3)]);
  });
  it("returns clear request failures for invalid cursors and does not accept arbitrary page sizes", async () => {
    for (const path of [
      "/public/movies/directory",
      "/public/series/directory",
      "/public/discovery/creators",
      "/public/discovery/tv",
    ]) {
      for (const query of ["limit=9999", "cursor=invalid", "offset=1000", "limit=-1"]) {
        expect((await app.inject({ url: `${path}?${query}` })).statusCode).toBe(400);
      }
    }
  });
});
