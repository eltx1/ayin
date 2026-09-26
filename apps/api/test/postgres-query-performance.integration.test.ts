import { createPrismaClient } from "@ayin/db";
import { afterAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const prisma = createPrismaClient(testDatabaseUrl);

type ExplainRow = { "QUERY PLAN": unknown };
type IndexRow = { indexname: string };

function planText(rows: ExplainRow[]): string {
  return JSON.stringify(rows.map((row) => row["QUERY PLAN"]));
}

databaseDescribe("Task 86 PostgreSQL query-plan regressions", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps the measured discovery, trending and revenue hot paths indexable", async () => {
    const addedIndexes = [
      "video_public_feed_idx",
      "media_asset_playable_video_idx",
      "watch_history_trending_time_idx",
      "earnings_channel_currency_time_idx",
    ];
    const indexRows = await prisma.$queryRawUnsafe<IndexRow[]>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'video_public_feed_idx',
          'media_asset_playable_video_idx',
          'watch_history_trending_time_idx',
          'earnings_channel_currency_time_idx'
        )
    `);
    expect(new Set(indexRows.map((row) => row.indexname))).toEqual(new Set(addedIndexes));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");

      const discovery = await tx.$queryRawUnsafe<ExplainRow[]>(`
        EXPLAIN (FORMAT JSON)
        SELECT v."id"
        FROM "Video" v
        WHERE v."status" = 'PUBLISHED'
          AND v."visibility" = 'PUBLIC'
          AND v."removedAt" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "MediaAsset" ma
            WHERE ma."videoId" = v."id"
              AND ma."kind" = 'SOURCE_VIDEO'
              AND ma."status" = 'VALIDATED'
              AND ma."removedAt" IS NULL
              AND ma."mimeType" = 'video/mp4'
          )
        ORDER BY v."publishedAt" DESC, v."id" DESC
        LIMIT 25
      `);
      const discoveryPlan = planText(discovery);
      expect(discoveryPlan).not.toContain('"Node Type":"Seq Scan"');

      const trending = await tx.$queryRawUnsafe<ExplainRow[]>(`
        EXPLAIN (FORMAT JSON)
        SELECT "videoId", SUM("viewCount")
        FROM "WatchHistory"
        WHERE "lastWatchedAt" >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        GROUP BY "videoId"
        ORDER BY SUM("viewCount") DESC, "videoId" ASC
        LIMIT 25
      `);
      const trendingPlan = planText(trending);
      expect(trendingPlan).not.toContain('"Node Type":"Seq Scan"');
      expect(trendingPlan).toContain("watch_history_trending_time_idx");

      const revenue = await tx.$queryRawUnsafe<ExplainRow[]>(`
        EXPLAIN (FORMAT JSON)
        SELECT COALESCE(SUM("amount"), 0)
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = '10000000-0000-4000-8000-000000000001'::uuid
          AND "currency" = 'USD'
          AND "occurredAt" >= CURRENT_TIMESTAMP - INTERVAL '90 days'
      `);
      expect(planText(revenue)).not.toContain('"Node Type":"Seq Scan"');
    });
  });

  it("preserves existing indexes for search, analytics, queue and admin reports", async () => {
    const expected = [
      "search_video_title_prefix_idx",
      "AnalyticsChannelDailyRollup_channelId_bucketStart_idx",
      "MediaProcessingJob_status_priority_queuedAt_idx",
      "Report_status_createdAt_idx",
    ];
    const rows = await prisma.$queryRawUnsafe<IndexRow[]>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'search_video_title_prefix_idx',
          'AnalyticsChannelDailyRollup_channelId_bucketStart_idx',
          'MediaProcessingJob_status_priority_queuedAt_idx',
          'Report_status_createdAt_idx'
        )
    `);
    expect(new Set(rows.map((row) => row.indexname))).toEqual(new Set(expected));
  });
});
