import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
const [baselineRoot, candidateRoot, outputPath] = process.argv.slice(2);
if (!baselineRoot || !candidateRoot)
  throw new Error(
    "Usage: node catalog-search-benchmark.mjs BASELINE_ROOT CANDIDATE_ROOT [OUTPUT_JSON]",
  );
const load = (root, file) => import(pathToFileURL(`${root}/${file}`).href);
const { PrismaClient } = await load(candidateRoot, "packages/db/dist/index.js");
const { PrismaPg } = await load(
  candidateRoot,
  "packages/db/node_modules/@prisma/adapter-pg/dist/index.mjs",
);
const { default: pg } = await load(candidateRoot, "packages/db/node_modules/pg/lib/index.js");
const { default: Fastify } = await load(candidateRoot, "apps/api/node_modules/fastify/fastify.js");
await load(candidateRoot, "apps/api/node_modules/reflect-metadata/Reflect.js");
if (
  !process.env.TEST_DATABASE_URL ||
  new URL(process.env.TEST_DATABASE_URL).hostname !== "127.0.0.1" ||
  new URL(process.env.TEST_DATABASE_URL).pathname !== "/ayin_catalog_search"
)
  throw new Error("Dedicated loopback ayin_catalog_search test DB required");
async function implementation(root) {
  let measuring = false,
    sqlStatements = 0,
    prismaOperations = 0;
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
  pool.on("connect", (connection) => {
    const query = connection.query;
    connection.query = function (...args) {
      if (measuring) sqlStatements += 1;
      return query.apply(this, args);
    };
  });
  const raw = new PrismaClient({ adapter: new PrismaPg(pool) });
  const measured = raw.$extends({
    query: {
      async $allOperations({ args, query }) {
        if (measuring) prismaOperations += 1;
        return query(args);
      },
    },
  });
  const database = { client: measured };
  const imports = await Promise.all(
    [
      "video-policy/video-policy.service.js",
      "movie-catalog/movie-catalog.service.js",
      "series-catalog/series-catalog.service.js",
      "catalog-localization/catalog-localization.service.js",
      "search/search-language-context.service.js",
      "search/language-aware-postgres-search.service.js",
      "search/search.service.js",
      "search/search.controller.js",
      "search/search-rate-limiter.js",
      "video-policy/trusted-region.service.js",
    ].map((file) => load(root, `apps/api/dist/${file}`)),
  );
  const [
    policyM,
    movieM,
    seriesM,
    localizationM,
    languageM,
    postgresM,
    searchM,
    controllerM,
    limiterM,
    regionM,
  ] = imports;
  const policy = new policyM.VideoPolicyService(database);
  const movies = new movieM.MovieCatalogService(database, policy, {});
  const series = new seriesM.SeriesCatalogService(database, policy, {});
  const localization = new localizationM.CatalogLocalizationService(database, {});
  const language = new languageM.SearchLanguageContextService();
  const postgres = new postgresM.LanguageAwarePostgresSearchService(database, language);
  const search = new searchM.SearchService(
    database,
    postgres,
    series,
    movies,
    policy,
    localization,
    language,
  );
  const controller = new controllerM.SearchController(
    search,
    {},
    new limiterM.SearchRateLimiter(),
    new regionM.TrustedRegionService(),
    language,
  );
  const app = Fastify();
  app.get("/public/search", (request) =>
    controller.search(request, request.query, request.headers),
  );
  await app.ready();
  return {
    raw,
    async run() {
      sqlStatements = 0;
      prismaOperations = 0;
      measuring = true;
      const started = performance.now();
      const response = await app.inject({
        url: "/public/search?q=Aurora&limit=24",
        headers: { "x-ayin-locale": "en" },
      });
      const durationMs = performance.now() - started;
      measuring = false;
      if (response.statusCode !== 200) throw new Error(response.body);
      const body = response.json();
      return {
        durationMs: Number(durationMs.toFixed(2)),
        sqlStatements,
        prismaOperations,
        resultCount: body.items.length,
        hasNextPage: Boolean(body.nextCursor),
      };
    },
    async close() {
      await app.close();
      await raw.$disconnect();
      await pool.end();
    },
  };
}
const baseline = await implementation(baselineRoot),
  candidate = await implementation(candidateRoot);
try {
  const prisma = candidate.raw;
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Movie", "Series", "Channel", "Account" CASCADE');
  const channel = await prisma.channel.create({
    data: { name: "Benchmark fixture", handle: `benchmark-${randomUUID()}` },
  });
  const video = await prisma.video.create({
    data: {
      channelId: channel.id,
      title: "Playback fixture",
      slug: `benchmark-${randomUUID()}`,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      mediaAssets: {
        create: {
          channelId: channel.id,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          mimeType: "video/mp4",
          sizeBytes: 2048n,
          r2ObjectKey: `benchmark/${randomUUID()}.mp4`,
        },
      },
    },
  });
  for (let index = 0; index < 110; index++) {
    const title = `Aurora ${String(index).padStart(3, "0")}`;
    await prisma.movie.create({
      data: {
        title,
        slug: `benchmark-movie-${index}`,
        synopsis: "Catalog measurement fixture",
        releaseYear: 2026,
        runtimeMinutes: 90,
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        primaryVideoId: video.id,
        availability: { create: { territoryCode: "*", rule: "ALLOW" } },
        localizations: { create: { locale: "ar", title: `رحلة ${index}` } },
      },
    });
    await prisma.series.create({
      data: {
        title,
        slug: `benchmark-series-${index}`,
        synopsis: "Catalog measurement fixture",
        maturityRating: "PG",
        originalLanguage: "en",
        status: "PUBLISHED",
        localizations: { create: { locale: "ar", title: `مسلسل ${index}` } },
        seasons: {
          create: {
            seasonNumber: 1,
            episodes: {
              create: {
                episodeNumber: 1,
                title: "Pilot",
                synopsis: "Pilot",
                status: "PUBLISHED",
                videoId: video.id,
              },
            },
          },
        },
      },
    });
  }
  await baseline.run();
  await candidate.run();
  const samples = { baseline: [], candidate: [] };
  for (let index = 0; index < 5; index++) {
    samples.baseline.push(await baseline.run());
    samples.candidate.push(await candidate.run());
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summarize = (rows) => ({
    apiRequestsPerSample: 1,
    medianDurationMs: median(rows.map((row) => row.durationMs)),
    sqlStatementsPerRequest: [...new Set(rows.map((row) => row.sqlStatements))],
    prismaOperationsPerRequest: [...new Set(rows.map((row) => row.prismaOperations))],
    resultsPerRequest: [...new Set(rows.map((row) => row.resultCount))],
    hasNextPage: rows.every((row) => row.hasNextPage),
  });
  const result = JSON.stringify(
    {
      fixture: { movies: 110, series: 110, episodesPerSeries: 1, playableVideoSources: 1 },
      method:
        "Fastify-injected real SearchController, warm alternating samples; pg Client.query counts actual SQL statements; local lab, not production capacity evidence",
      baseline: summarize(samples.baseline),
      candidate: summarize(samples.candidate),
      samples,
    },
    null,
    2,
  );
  if (outputPath) writeFileSync(outputPath, result);
  process.stdout.write(result);
} finally {
  await candidate.raw.$executeRawUnsafe(
    'TRUNCATE TABLE "Movie", "Series", "Channel", "Account" CASCADE',
  );
  await baseline.close();
  await candidate.close();
}
