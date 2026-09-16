import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  PostgresSearchService,
  escapeLikePrefix,
  type SearchCandidate,
  type SearchCandidateType,
} from "./search-postgres.service.js";
import { SearchLanguageContextService } from "./search-language-context.service.js";
import { resolveSearchLanguage } from "./search-language.js";

type LanguageCandidateRow = {
  id: string;
  type: string;
  slug: string | null;
  score: number;
};

const candidateTypes = new Set<SearchCandidateType>([
  "VIDEO",
  "CHANNEL",
  "PLAYLIST",
  "CREATOR_TV",
  "SERIES",
  "MOVIE",
]);
const maxLanguageCandidates = 192;

/**
 * Adds language-aware PostgreSQL signals on top of Search V2. The base service stays
 * language-neutral, which preserves exact names across languages. This service is local-only:
 * query text is sent only to PostgreSQL and never to an AI/search provider.
 */
@Injectable()
export class LanguageAwarePostgresSearchService extends PostgresSearchService {
  constructor(
    @Inject(DatabaseService) private readonly languageDatabase: DatabaseService,
    @Inject(SearchLanguageContextService)
    private readonly languageContext: SearchLanguageContextService,
  ) {
    super(languageDatabase);
  }

  override async searchCandidates(
    query: string,
    requestedPerType = 32,
  ): Promise<SearchCandidate[]> {
    const selection = resolveSearchLanguage(query, this.languageContext.currentUiLocale());
    const [base, languageAware] = await Promise.all([
      super.searchCandidates(query, requestedPerType),
      this.languageCandidates(
        query,
        selection.matchQuery,
        selection.preferredLanguage,
        selection.uiLanguage,
        requestedPerType,
      ),
    ]);
    const merged = mergeCandidates(base, languageAware);
    return this.applyContentLanguageAffinity(merged, selection.preferredLanguage);
  }

  private async applyContentLanguageAffinity(
    candidates: SearchCandidate[],
    preferredLanguage: "ar" | "en" | "und",
  ): Promise<SearchCandidate[]> {
    if (preferredLanguage === "und" || candidates.length === 0) return candidates;

    const videoIds = candidates.filter((item) => item.type === "VIDEO").map((item) => item.id);
    const seriesIds = candidates.filter((item) => item.type === "SERIES").map((item) => item.id);
    const movieIds = candidates.filter((item) => item.type === "MOVIE").map((item) => item.id);

    const [videoMetadata, series, movies] = await Promise.all([
      videoIds.length
        ? this.languageDatabase.client.videoCreatorMetadata.findMany({
            where: { videoId: { in: videoIds } },
            select: { videoId: true, primaryLanguage: true },
          })
        : [],
      seriesIds.length
        ? this.languageDatabase.client.series.findMany({
            where: { id: { in: seriesIds } },
            select: { id: true, originalLanguage: true },
          })
        : [],
      movieIds.length
        ? this.languageDatabase.client.movie.findMany({
            where: { id: { in: movieIds } },
            select: { id: true, originalLanguage: true },
          })
        : [],
    ]);

    const affinity = new Set<string>();
    for (const item of videoMetadata) {
      if (languageBase(item.primaryLanguage) === preferredLanguage)
        affinity.add(`VIDEO:${item.videoId}`);
    }
    for (const item of series) {
      if (languageBase(item.originalLanguage) === preferredLanguage)
        affinity.add(`SERIES:${item.id}`);
    }
    for (const item of movies) {
      if (languageBase(item.originalLanguage) === preferredLanguage)
        affinity.add(`MOVIE:${item.id}`);
    }

    return candidates
      .map((candidate) =>
        affinity.has(`${candidate.type}:${candidate.id}`)
          ? { ...candidate, score: candidate.score + 8 }
          : candidate,
      )
      .toSorted(
        (a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
      );
  }

  private async languageCandidates(
    query: string,
    matchQuery: string,
    preferredLanguage: "ar" | "en" | "und",
    uiLanguage: "ar" | "en" | "und",
    requestedPerType: number,
  ): Promise<SearchCandidate[]> {
    const rawPrefix = escapeLikePrefix(query);
    const matchPrefix = escapeLikePrefix(matchQuery);
    const fuzzy = Array.from(query).length >= 3;
    const useEnglish = preferredLanguage === "en";
    const useArabic = preferredLanguage === "ar";
    const limit = Math.min(Math.max(requestedPerType, 1) * 6, maxLanguageCandidates);

    const rows = await this.languageDatabase.client.$queryRaw<LanguageCandidateRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT
          v."id"::text AS "id",
          'VIDEO'::text AS "type",
          v."slug"::text AS "slug",
          (
            CASE
              WHEN lower(v."title") = lower(${query}) THEN 142
              WHEN lower(v."title") LIKE ${rawPrefix} ESCAPE '\\' THEN 104
              WHEN ${useArabic}::boolean
                AND ayin_arabic_search_normalize(v."title") = ${matchQuery} THEN 136
              WHEN ${useArabic}::boolean
                AND ayin_arabic_search_normalize(v."title") LIKE ${matchPrefix} ESCAPE '\\' THEN 98
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(v."title", '') || ' ' || coalesce(v."description", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 40 + ts_rank_cd(
                  to_tsvector('english', coalesce(v."title", '') || ' ' || coalesce(v."description", '')),
                  plainto_tsquery('english', ${query})
                ) * 34
              WHEN ${useArabic}::boolean
                AND to_tsvector('simple', ayin_arabic_search_normalize(coalesce(v."title", '') || ' ' || coalesce(v."description", '')))
                  @@ plainto_tsquery('simple', ${matchQuery})
                THEN 38 + ts_rank_cd(
                  to_tsvector('simple', ayin_arabic_search_normalize(coalesce(v."title", '') || ' ' || coalesce(v."description", ''))),
                  plainto_tsquery('simple', ${matchQuery})
                ) * 30
              ELSE 0
            END
            + CASE WHEN ${useArabic}::boolean AND ${fuzzy}::boolean
                THEN similarity(ayin_arabic_search_normalize(v."title"), ${matchQuery}) * 18
                ELSE 0 END
          )::double precision AS "score"
        FROM "Video" v
        LEFT JOIN "VideoCreatorMetadata" vm ON vm."videoId" = v."id"
        JOIN "Channel" c ON c."id" = v."channelId"
        WHERE v."status" = 'PUBLISHED'
          AND v."visibility" = 'PUBLIC'
          AND v."removedAt" IS NULL
          AND c."status" = 'ACTIVE'
          AND c."removedAt" IS NULL
          AND (
            lower(v."title") = lower(${query})
            OR lower(v."title") LIKE ${rawPrefix} ESCAPE '\\'
            OR (${useArabic}::boolean AND ayin_arabic_search_normalize(v."title") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useArabic}::boolean AND ${fuzzy}::boolean AND ayin_arabic_search_normalize(v."title") % ${matchQuery})
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(v."title", '') || ' ' || coalesce(v."description", '')
              ) @@ plainto_tsquery('english', ${query}))
            OR (${useArabic}::boolean AND to_tsvector(
                'simple', ayin_arabic_search_normalize(coalesce(v."title", '') || ' ' || coalesce(v."description", ''))
              ) @@ plainto_tsquery('simple', ${matchQuery}))
          )

        UNION ALL

        SELECT
          c."id"::text,
          'CHANNEL'::text,
          c."handle"::text,
          (
            CASE
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(c."name") = ${matchQuery} THEN 112
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(c."name") LIKE ${matchPrefix} ESCAPE '\\' THEN 86
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(c."name", '') || ' ' || coalesce(c."description", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 34 + ts_rank_cd(
                  to_tsvector('english', coalesce(c."name", '') || ' ' || coalesce(c."description", '')),
                  plainto_tsquery('english', ${query})
                ) * 24
              ELSE 0
            END
          )::double precision
        FROM "Channel" c
        WHERE c."status" = 'ACTIVE'
          AND c."removedAt" IS NULL
          AND (
            (${useArabic}::boolean AND ayin_arabic_search_normalize(c."name") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useArabic}::boolean AND ${fuzzy}::boolean AND ayin_arabic_search_normalize(c."name") % ${matchQuery})
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(c."name", '') || ' ' || coalesce(c."description", '')
              ) @@ plainto_tsquery('english', ${query}))
          )

        UNION ALL

        SELECT
          p."id"::text,
          'PLAYLIST'::text,
          p."slug"::text,
          (
            CASE
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(p."name") = ${matchQuery} THEN 104
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(p."name") LIKE ${matchPrefix} ESCAPE '\\' THEN 80
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(p."name", '') || ' ' || coalesce(p."description", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 32 + ts_rank_cd(
                  to_tsvector('english', coalesce(p."name", '') || ' ' || coalesce(p."description", '')),
                  plainto_tsquery('english', ${query})
                ) * 22
              ELSE 0
            END
          )::double precision
        FROM "Playlist" p
        JOIN "Channel" c ON c."id" = p."channelId"
        WHERE p."deletedAt" IS NULL
          AND p."visibility" = 'PUBLIC'
          AND c."status" = 'ACTIVE'
          AND c."removedAt" IS NULL
          AND (
            (${useArabic}::boolean AND ayin_arabic_search_normalize(p."name") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(p."name", '') || ' ' || coalesce(p."description", '')
              ) @@ plainto_tsquery('english', ${query}))
          )

        UNION ALL

        SELECT
          tv."id"::text,
          'CREATOR_TV'::text,
          tv."slug"::text,
          (
            CASE
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(tv."name") = ${matchQuery} THEN 106
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(tv."name") LIKE ${matchPrefix} ESCAPE '\\' THEN 82
              ELSE 0
            END
          )::double precision
        FROM "CreatorTvChannel" tv
        JOIN "Channel" c ON c."id" = tv."channelId"
        WHERE tv."status" = 'ACTIVE'
          AND tv."disabledAt" IS NULL
          AND c."status" = 'ACTIVE'
          AND c."removedAt" IS NULL
          AND ${useArabic}::boolean
          AND ayin_arabic_search_normalize(tv."name") LIKE ${matchPrefix} ESCAPE '\\'

        UNION ALL

        SELECT
          s."id"::text,
          'SERIES'::text,
          s."slug"::text,
          (
            CASE
              WHEN lower(s."title") = lower(${query}) THEN 140
              WHEN lower(s."title") LIKE ${rawPrefix} ESCAPE '\\' THEN 102
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(s."title") = ${matchQuery} THEN 136
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(s."title") LIKE ${matchPrefix} ESCAPE '\\' THEN 98
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(s."title", '') || ' ' || coalesce(s."synopsis", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 40 + ts_rank_cd(
                  to_tsvector('english', coalesce(s."title", '') || ' ' || coalesce(s."synopsis", '')),
                  plainto_tsquery('english', ${query})
                ) * 30
              WHEN ${useArabic}::boolean
                AND to_tsvector('simple', ayin_arabic_search_normalize(coalesce(s."title", '') || ' ' || coalesce(s."synopsis", '')))
                  @@ plainto_tsquery('simple', ${matchQuery})
                THEN 38 + ts_rank_cd(
                  to_tsvector('simple', ayin_arabic_search_normalize(coalesce(s."title", '') || ' ' || coalesce(s."synopsis", ''))),
                  plainto_tsquery('simple', ${matchQuery})
                ) * 28
              ELSE 0
            END
          )::double precision
        FROM "Series" s
        WHERE s."status" = 'PUBLISHED'
          AND (
            lower(s."title") = lower(${query})
            OR lower(s."title") LIKE ${rawPrefix} ESCAPE '\\'
            OR (${useArabic}::boolean AND ayin_arabic_search_normalize(s."title") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(s."title", '') || ' ' || coalesce(s."synopsis", '')
              ) @@ plainto_tsquery('english', ${query}))
            OR (${useArabic}::boolean AND to_tsvector(
                'simple', ayin_arabic_search_normalize(coalesce(s."title", '') || ' ' || coalesce(s."synopsis", ''))
              ) @@ plainto_tsquery('simple', ${matchQuery}))
          )

        UNION ALL

        SELECT
          s."id"::text,
          'SERIES'::text,
          s."slug"::text,
          (
            CASE
              WHEN lower(sl."title") = lower(${query}) THEN 144
              WHEN lower(sl."title") LIKE ${rawPrefix} ESCAPE '\\' THEN 106
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(sl."title") = ${matchQuery} THEN 140
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(sl."title") LIKE ${matchPrefix} ESCAPE '\\' THEN 102
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 42 + ts_rank_cd(
                  to_tsvector('english', coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", '')),
                  plainto_tsquery('english', ${query})
                ) * 30
              WHEN ${useArabic}::boolean
                AND to_tsvector('simple', ayin_arabic_search_normalize(coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", '')))
                  @@ plainto_tsquery('simple', ${matchQuery})
                THEN 40 + ts_rank_cd(
                  to_tsvector('simple', ayin_arabic_search_normalize(coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", ''))),
                  plainto_tsquery('simple', ${matchQuery})
                ) * 28
              ELSE 0
            END
            + CASE
                WHEN ${uiLanguage} <> 'und'
                  AND lower(split_part(sl."locale", '-', 1)) = ${uiLanguage}
                  THEN 10 ELSE 0
              END
          )::double precision
        FROM "SeriesLocalization" sl
        JOIN "Series" s ON s."id" = sl."seriesId"
        WHERE s."status" = 'PUBLISHED'
          AND sl."title" IS NOT NULL
          AND (
            lower(sl."title") = lower(${query})
            OR lower(sl."title") LIKE ${rawPrefix} ESCAPE '\\'
            OR (${fuzzy}::boolean AND lower(sl."title") % lower(${query}))
            OR (${useArabic}::boolean AND ayin_arabic_search_normalize(sl."title") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", '')
              ) @@ plainto_tsquery('english', ${query}))
            OR (${useArabic}::boolean AND to_tsvector(
                'simple', ayin_arabic_search_normalize(coalesce(sl."title", '') || ' ' || coalesce(sl."synopsis", '') || ' ' || coalesce(sl."shortDescription", ''))
              ) @@ plainto_tsquery('simple', ${matchQuery}))
          )

        UNION ALL

        SELECT
          m."id"::text,
          'MOVIE'::text,
          m."slug"::text,
          (
            CASE
              WHEN lower(m."title") = lower(${query}) THEN 140
              WHEN lower(m."title") LIKE ${rawPrefix} ESCAPE '\\' THEN 102
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(m."title") = ${matchQuery} THEN 136
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(m."title") LIKE ${matchPrefix} ESCAPE '\\' THEN 98
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(m."title", '') || ' ' || coalesce(m."synopsis", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 40 + ts_rank_cd(
                  to_tsvector('english', coalesce(m."title", '') || ' ' || coalesce(m."synopsis", '')),
                  plainto_tsquery('english', ${query})
                ) * 30
              WHEN ${useArabic}::boolean
                AND to_tsvector('simple', ayin_arabic_search_normalize(coalesce(m."title", '') || ' ' || coalesce(m."synopsis", '')))
                  @@ plainto_tsquery('simple', ${matchQuery})
                THEN 38 + ts_rank_cd(
                  to_tsvector('simple', ayin_arabic_search_normalize(coalesce(m."title", '') || ' ' || coalesce(m."synopsis", ''))),
                  plainto_tsquery('simple', ${matchQuery})
                ) * 28
              ELSE 0
            END
          )::double precision
        FROM "Movie" m
        WHERE m."status" = 'PUBLISHED'
          AND m."primaryVideoId" IS NOT NULL
          AND (
            lower(m."title") = lower(${query})
            OR lower(m."title") LIKE ${rawPrefix} ESCAPE '\\'
            OR (${useArabic}::boolean AND ayin_arabic_search_normalize(m."title") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(m."title", '') || ' ' || coalesce(m."synopsis", '')
              ) @@ plainto_tsquery('english', ${query}))
            OR (${useArabic}::boolean AND to_tsvector(
                'simple', ayin_arabic_search_normalize(coalesce(m."title", '') || ' ' || coalesce(m."synopsis", ''))
              ) @@ plainto_tsquery('simple', ${matchQuery}))
          )

        UNION ALL

        SELECT
          m."id"::text,
          'MOVIE'::text,
          m."slug"::text,
          (
            CASE
              WHEN lower(ml."title") = lower(${query}) THEN 144
              WHEN lower(ml."title") LIKE ${rawPrefix} ESCAPE '\\' THEN 106
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(ml."title") = ${matchQuery} THEN 140
              WHEN ${useArabic}::boolean AND ayin_arabic_search_normalize(ml."title") LIKE ${matchPrefix} ESCAPE '\\' THEN 102
              WHEN ${useEnglish}::boolean
                AND to_tsvector('english', coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", ''))
                  @@ plainto_tsquery('english', ${query})
                THEN 42 + ts_rank_cd(
                  to_tsvector('english', coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", '')),
                  plainto_tsquery('english', ${query})
                ) * 30
              WHEN ${useArabic}::boolean
                AND to_tsvector('simple', ayin_arabic_search_normalize(coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", '')))
                  @@ plainto_tsquery('simple', ${matchQuery})
                THEN 40 + ts_rank_cd(
                  to_tsvector('simple', ayin_arabic_search_normalize(coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", ''))),
                  plainto_tsquery('simple', ${matchQuery})
                ) * 28
              ELSE 0
            END
            + CASE
                WHEN ${uiLanguage} <> 'und'
                  AND lower(split_part(ml."locale", '-', 1)) = ${uiLanguage}
                  THEN 10 ELSE 0
              END
          )::double precision
        FROM "MovieLocalization" ml
        JOIN "Movie" m ON m."id" = ml."movieId"
        WHERE m."status" = 'PUBLISHED'
          AND m."primaryVideoId" IS NOT NULL
          AND ml."title" IS NOT NULL
          AND (
            lower(ml."title") = lower(${query})
            OR lower(ml."title") LIKE ${rawPrefix} ESCAPE '\\'
            OR (${fuzzy}::boolean AND lower(ml."title") % lower(${query}))
            OR (${useArabic}::boolean AND ayin_arabic_search_normalize(ml."title") LIKE ${matchPrefix} ESCAPE '\\')
            OR (${useEnglish}::boolean AND to_tsvector(
                'english', coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", '')
              ) @@ plainto_tsquery('english', ${query}))
            OR (${useArabic}::boolean AND to_tsvector(
                'simple', ayin_arabic_search_normalize(coalesce(ml."title", '') || ' ' || coalesce(ml."synopsis", '') || ' ' || coalesce(ml."shortDescription", ''))
              ) @@ plainto_tsquery('simple', ${matchQuery}))
          )
      )
      SELECT "id", "type", "slug", "score"
      FROM candidates
      WHERE "score" > 0
      ORDER BY "score" DESC, "type" ASC, "id" ASC
      LIMIT ${limit}
    `);

    return rows.flatMap((row) => {
      if (!candidateTypes.has(row.type as SearchCandidateType)) return [];
      if (!Number.isFinite(row.score)) return [];
      return [
        {
          id: row.id,
          type: row.type as SearchCandidateType,
          slug: row.slug,
          score: row.score,
        },
      ];
    });
  }
}

function languageBase(value: string | null | undefined): string | undefined {
  return value?.trim().replaceAll("_", "-").split("-")[0]?.toLocaleLowerCase();
}

function mergeCandidates(
  base: SearchCandidate[],
  languageAware: SearchCandidate[],
): SearchCandidate[] {
  const merged = new Map<string, SearchCandidate>();
  for (const candidate of [...base, ...languageAware]) {
    const key = `${candidate.type}:${candidate.id}`;
    const current = merged.get(key);
    if (!current || candidate.score > current.score) merged.set(key, candidate);
  }
  return [...merged.values()].toSorted(
    (a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
  );
}
