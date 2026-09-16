import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LanguageAwarePostgresSearchService } from "../src/search/language-aware-postgres-search.service.js";
import { SearchLanguageContextService } from "../src/search/search-language-context.service.js";

const client = createPrismaClient();
const database = { client } as never;
const context = new SearchLanguageContextService();
const search = new LanguageAwarePostgresSearchService(database, context);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let channelId = "";
let englishVideoId = "";
let arabicVideoId = "";
let movieId = "";
let seriesId = "";
let englishAffinityMovieId = "";
let arabicAffinityMovieId = "";

beforeAll(async () => {
  const channel = await client.channel.create({
    data: { handle: `search65-${suffix}`, name: "Search 65 Language Lab", status: "ACTIVE" },
  });
  channelId = channel.id;

  const [englishVideo, arabicVideo] = await Promise.all([
    client.video.create({
      data: {
        channelId,
        slug: `marathon-journal-${suffix}`,
        title: "Marathon Journal",
        description: "Athletes were running daily while dedicated runners trained together.",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    }),
    client.video.create({
      data: {
        channelId,
        slug: `ibrahim-ar-${suffix}`,
        title: "إِبْرَاهِيم",
        description: "رحلة عربية أصلية",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    }),
  ]);
  englishVideoId = englishVideo.id;
  arabicVideoId = arabicVideo.id;

  await Promise.all([
    client.videoCreatorMetadata.create({
      data: { videoId: englishVideo.id, primaryLanguage: "en-US", tags: [] },
    }),
    client.videoCreatorMetadata.create({
      data: { videoId: arabicVideo.id, primaryLanguage: "ar-EG", tags: [] },
    }),
  ]);

  const movie = await client.movie.create({
    data: {
      title: "The Nile Chronicle",
      slug: `nile-chronicle-${suffix}`,
      synopsis: "A documentary journey along the river.",
      releaseYear: 2026,
      runtimeMinutes: 90,
      maturityRating: "PG",
      originalLanguage: "en",
      status: "PUBLISHED",
      primaryVideoId: englishVideo.id,
      publishedAt: new Date(),
      localizations: {
        create: {
          locale: "ar-EG",
          title: "حكاية النيل",
          synopsis: "رحلة وثائقية على ضفاف النيل",
          shortDescription: "حكاية عربية محلية",
        },
      },
    },
  });
  movieId = movie.id;

  const series = await client.series.create({
    data: {
      title: "دروب الصحراء",
      slug: `desert-paths-${suffix}`,
      synopsis: "مسلسل رحلات عربي",
      releaseYear: 2026,
      maturityRating: "PG",
      originalLanguage: "ar",
      status: "PUBLISHED",
      publishedAt: new Date(),
      localizations: {
        create: {
          locale: "en-US",
          title: "Desert Paths",
          synopsis: "Travel stories across the desert.",
          shortDescription: "An English localized title.",
        },
      },
    },
  });
  seriesId = series.id;

  const [englishAffinity, arabicAffinity] = await Promise.all([
    client.movie.create({
      data: {
        title: "Shared Horizon",
        slug: `shared-horizon-en-${suffix}`,
        synopsis: "English original fixture",
        releaseYear: 2026,
        runtimeMinutes: 80,
        maturityRating: "PG",
        originalLanguage: "en-GB",
        status: "PUBLISHED",
        primaryVideoId: englishVideo.id,
        publishedAt: new Date(),
      },
    }),
    client.movie.create({
      data: {
        title: "Shared Horizon",
        slug: `shared-horizon-ar-${suffix}`,
        synopsis: "Arabic original fixture",
        releaseYear: 2026,
        runtimeMinutes: 80,
        maturityRating: "PG",
        originalLanguage: "ar",
        status: "PUBLISHED",
        primaryVideoId: englishVideo.id,
        publishedAt: new Date(),
      },
    }),
  ]);
  englishAffinityMovieId = englishAffinity.id;
  arabicAffinityMovieId = arabicAffinity.id;
});

afterAll(async () => {
  await client.movie.deleteMany({
    where: {
      id: { in: [movieId, englishAffinityMovieId, arabicAffinityMovieId].filter(Boolean) },
    },
  });
  if (seriesId) await client.series.delete({ where: { id: seriesId } });
  if (channelId) await client.video.deleteMany({ where: { channelId } });
  if (channelId) await client.channel.delete({ where: { id: channelId } });
  await client.$disconnect();
});

describe("Task 65 language-aware PostgreSQL search", () => {
  it("uses English stemming where simple tokenization would miss the inflection", async () => {
    const results = await context.run("en-US", "search", () => search.searchCandidates("runs", 12));
    expect(results.some((item) => item.id === englishVideoId)).toBe(true);
  });

  it("matches Arabic Alef variants and harakat without changing stored titles", async () => {
    const results = await context.run("ar-EG", "search", () =>
      search.searchCandidates("ابراهيم", 12),
    );
    const match = results.find((item) => item.id === arabicVideoId);
    expect(match).toBeDefined();
    expect(match?.score ?? 0).toBeGreaterThan(130);

    const normalized = await client.$queryRaw<Array<{ normalized: string; preserved: string }>>`
      SELECT
        ayin_arabic_search_normalize('إِبْرَاهِيم') AS normalized,
        ayin_arabic_search_normalize('مدرسة') AS preserved
    `;
    expect(normalized[0]).toEqual({ normalized: "ابراهيم", preserved: "مدرسة" });
  });

  it("searches Task 61 Arabic Movie localization metadata without transliteration", async () => {
    const results = await context.run("ar-EG", "search", () =>
      search.searchCandidates("حكاية النيل", 12),
    );
    expect(results.some((item) => item.type === "MOVIE" && item.id === movieId)).toBe(true);
  });

  it("keeps cross-language exact localized names discoverable even under another UI locale", async () => {
    const results = await context.run("ar-EG", "search", () =>
      search.searchCandidates("Desert Paths", 12),
    );
    expect(results.some((item) => item.type === "SERIES" && item.id === seriesId)).toBe(true);
  });

  it("uses content primary/original language only as a ranking bonus", async () => {
    const results = await context.run("en-US", "search", () =>
      search.searchCandidates("Shared Horizon", 12),
    );
    const english = results.find((item) => item.id === englishAffinityMovieId);
    const arabic = results.find((item) => item.id === arabicAffinityMovieId);
    expect(english).toBeDefined();
    expect(arabic).toBeDefined();
    expect(english?.score ?? 0).toBeGreaterThan(arabic?.score ?? 0);
  });

  it("uses language-specific PostgreSQL indexes for bounded search plans", async () => {
    const plans = await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
      const english = await transaction.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
        EXPLAIN (FORMAT JSON)
        SELECT "id"
        FROM "Video"
        WHERE to_tsvector(
          'english', coalesce("title", '') || ' ' || coalesce("description", '')
        ) @@ plainto_tsquery('english', 'runs')
        LIMIT 20
      `;
      const arabic = await transaction.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
        EXPLAIN (FORMAT JSON)
        SELECT "id"
        FROM "Video"
        WHERE ayin_arabic_search_normalize("title") LIKE 'ابراهيم%'
        LIMIT 20
      `;
      return { english, arabic };
    });
    expect(JSON.stringify(plans.english)).toContain("search65_video_english_fts_idx");
    expect(JSON.stringify(plans.arabic)).toMatch(/search65_video_ar_title_(prefix|trgm)_idx/);
  });
});
