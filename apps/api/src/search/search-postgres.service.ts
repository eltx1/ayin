import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

export type SearchCandidateType =
  "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV" | "SERIES" | "MOVIE";

export interface SearchCandidate {
  id: string;
  type: SearchCandidateType;
  slug: string | null;
  score: number;
}

type SearchCandidateRow = {
  id: string;
  type: string;
  slug: string | null;
  score: number;
};

const maxCandidatesPerType = 64;
const candidateTypes = new Set<SearchCandidateType>([
  "VIDEO",
  "CHANNEL",
  "PLAYLIST",
  "CREATOR_TV",
  "SERIES",
  "MOVIE",
]);

@Injectable()
export class PostgresSearchService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async searchCandidates(query: string, requestedPerType = 32): Promise<SearchCandidate[]> {
    const limit = Math.min(Math.max(requestedPerType, 1), maxCandidatesPerType);
    const prefix = escapeLikePrefix(query);
    const fuzzy = Array.from(query).length >= 3;
    const rows = await Promise.all([
      this.videoCandidates(query, prefix, fuzzy, limit),
      this.channelCandidates(query, prefix, fuzzy, limit),
      this.playlistCandidates(query, prefix, fuzzy, limit),
      this.creatorTvCandidates(query, prefix, fuzzy, limit),
      this.seriesCandidates(query, prefix, fuzzy, limit),
      this.movieCandidates(query, prefix, fuzzy, limit),
    ]);
    return mergeCandidateRows(rows.flat());
  }

  async suggestCandidates(query: string, requestedLimit = 8): Promise<SearchCandidate[]> {
    const limit = Math.min(Math.max(requestedLimit, 1), 8);
    const candidates = await this.searchCandidates(query, Math.min(limit * 3, 24));
    const strongPrefixCandidates = candidates.filter((candidate) => candidate.score >= 60);
    return (strongPrefixCandidates.length ? strongPrefixCandidates : candidates).slice(
      0,
      limit * 4,
    );
  }

  private videoCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        v."id"::text AS "id",
        'VIDEO'::text AS "type",
        v."slug"::text AS "slug",
        (
          CASE
            WHEN lower(v."title") = lower(${query}) THEN 140
            WHEN lower(v."title") LIKE ${prefix} ESCAPE '\\' THEN 105
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN similarity(lower(v."title"), lower(${query})) * 35
              ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(v."title", '') || ' ' || coalesce(v."description", '')),
              plainto_tsquery('simple', ${query})
            ) * 25
          + CASE
              WHEN lower(c."name") = lower(${query}) THEN 40
              WHEN lower(c."handle") = lower(${query}) THEN 36
              WHEN lower(c."name") LIKE ${prefix} ESCAPE '\\' THEN 28
              WHEN lower(c."handle") LIKE ${prefix} ESCAPE '\\' THEN 26
              ELSE 0
            END
          + CASE WHEN ${fuzzy}::boolean
              THEN greatest(
                similarity(lower(c."name"), lower(${query})),
                similarity(lower(c."handle"), lower(${query}))
              ) * 12
              ELSE 0 END
        )::double precision AS "score"
      FROM "Video" v
      JOIN "Channel" c ON c."id" = v."channelId"
      WHERE v."status" = 'PUBLISHED'
        AND v."visibility" = 'PUBLIC'
        AND v."removedAt" IS NULL
        AND c."status" = 'ACTIVE'
        AND c."removedAt" IS NULL
        AND (
          lower(v."title") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(v."title") % lower(${query}))
          OR to_tsvector(
              'simple',
              coalesce(v."title", '') || ' ' || coalesce(v."description", '')
            ) @@ plainto_tsquery('simple', ${query})
          OR lower(c."name") LIKE ${prefix} ESCAPE '\\'
          OR lower(c."handle") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(c."name") % lower(${query}))
          OR (${fuzzy}::boolean AND lower(c."handle") % lower(${query}))
        )
      ORDER BY "score" DESC, v."publishedAt" DESC NULLS LAST, v."id" ASC
      LIMIT ${limit}
    `);
  }

  private channelCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        c."id"::text AS "id",
        'CHANNEL'::text AS "type",
        c."handle"::text AS "slug",
        (
          CASE
            WHEN lower(c."name") = lower(${query}) THEN 115
            WHEN lower(c."handle") = lower(${query}) THEN 110
            WHEN lower(c."name") LIKE ${prefix} ESCAPE '\\' THEN 90
            WHEN lower(c."handle") LIKE ${prefix} ESCAPE '\\' THEN 86
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN greatest(
                similarity(lower(c."name"), lower(${query})),
                similarity(lower(c."handle"), lower(${query}))
              ) * 32
              ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(c."name", '') || ' ' || coalesce(c."description", '')),
              plainto_tsquery('simple', ${query})
            ) * 18
        )::double precision AS "score"
      FROM "Channel" c
      WHERE c."status" = 'ACTIVE'
        AND c."removedAt" IS NULL
        AND (
          lower(c."name") LIKE ${prefix} ESCAPE '\\'
          OR lower(c."handle") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(c."name") % lower(${query}))
          OR (${fuzzy}::boolean AND lower(c."handle") % lower(${query}))
          OR to_tsvector(
              'simple',
              coalesce(c."name", '') || ' ' || coalesce(c."description", '')
            ) @@ plainto_tsquery('simple', ${query})
        )
      ORDER BY "score" DESC, c."createdAt" DESC, c."id" ASC
      LIMIT ${limit}
    `);
  }

  private playlistCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        p."id"::text AS "id",
        'PLAYLIST'::text AS "type",
        p."slug"::text AS "slug",
        (
          CASE
            WHEN lower(p."name") = lower(${query}) THEN 104
            WHEN lower(p."name") LIKE ${prefix} ESCAPE '\\' THEN 82
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN similarity(lower(p."name"), lower(${query})) * 28
              ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(p."name", '') || ' ' || coalesce(p."description", '')),
              plainto_tsquery('simple', ${query})
            ) * 18
          + CASE
              WHEN lower(c."name") = lower(${query}) THEN 18
              WHEN lower(c."name") LIKE ${prefix} ESCAPE '\\' THEN 12
              ELSE 0
            END
        )::double precision AS "score"
      FROM "Playlist" p
      JOIN "Channel" c ON c."id" = p."channelId"
      WHERE p."deletedAt" IS NULL
        AND p."visibility" = 'PUBLIC'
        AND c."status" = 'ACTIVE'
        AND c."removedAt" IS NULL
        AND (
          lower(p."name") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(p."name") % lower(${query}))
          OR to_tsvector(
              'simple',
              coalesce(p."name", '') || ' ' || coalesce(p."description", '')
            ) @@ plainto_tsquery('simple', ${query})
          OR lower(c."name") LIKE ${prefix} ESCAPE '\\'
        )
      ORDER BY "score" DESC, p."updatedAt" DESC, p."id" ASC
      LIMIT ${limit}
    `);
  }

  private creatorTvCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        tv."id"::text AS "id",
        'CREATOR_TV'::text AS "type",
        tv."slug"::text AS "slug",
        (
          CASE
            WHEN lower(tv."name") = lower(${query}) THEN 106
            WHEN lower(tv."name") LIKE ${prefix} ESCAPE '\\' THEN 84
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN similarity(lower(tv."name"), lower(${query})) * 30
              ELSE 0 END
          + CASE
              WHEN lower(c."name") = lower(${query}) THEN 20
              WHEN lower(c."name") LIKE ${prefix} ESCAPE '\\' THEN 14
              ELSE 0
            END
        )::double precision AS "score"
      FROM "CreatorTvChannel" tv
      JOIN "Channel" c ON c."id" = tv."channelId"
      WHERE tv."status" = 'ACTIVE'
        AND tv."disabledAt" IS NULL
        AND c."status" = 'ACTIVE'
        AND c."removedAt" IS NULL
        AND (
          lower(tv."name") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(tv."name") % lower(${query}))
          OR lower(c."name") LIKE ${prefix} ESCAPE '\\'
        )
      ORDER BY "score" DESC, tv."createdAt" DESC, tv."id" ASC
      LIMIT ${limit}
    `);
  }

  private seriesCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        s."id"::text AS "id",
        'SERIES'::text AS "type",
        s."slug"::text AS "slug",
        (
          CASE
            WHEN lower(s."title") = lower(${query}) THEN 132
            WHEN lower(s."title") LIKE ${prefix} ESCAPE '\\' THEN 100
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN similarity(lower(s."title"), lower(${query})) * 32
              ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(s."title", '') || ' ' || coalesce(s."synopsis", '')),
              plainto_tsquery('simple', ${query})
            ) * 24
          + CASE
              WHEN EXISTS (
                SELECT 1
                FROM "SeriesGenreAssignment" sga
                JOIN "SeriesGenre" sg ON sg."id" = sga."genreId"
                WHERE sga."seriesId" = s."id"
                  AND (lower(sg."name") = lower(${query}) OR lower(sg."slug") = lower(${query}))
              ) THEN 26
              WHEN EXISTS (
                SELECT 1
                FROM "SeriesGenreAssignment" sga
                JOIN "SeriesGenre" sg ON sg."id" = sga."genreId"
                WHERE sga."seriesId" = s."id"
                  AND (
                    lower(sg."name") LIKE ${prefix} ESCAPE '\\'
                    OR lower(sg."slug") LIKE ${prefix} ESCAPE '\\'
                  )
              ) THEN 18
              ELSE 0
            END
        )::double precision AS "score"
      FROM "Series" s
      WHERE s."status" = 'PUBLISHED'
        AND (
          lower(s."title") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(s."title") % lower(${query}))
          OR to_tsvector(
              'simple',
              coalesce(s."title", '') || ' ' || coalesce(s."synopsis", '')
            ) @@ plainto_tsquery('simple', ${query})
          OR EXISTS (
            SELECT 1
            FROM "SeriesGenreAssignment" sga
            JOIN "SeriesGenre" sg ON sg."id" = sga."genreId"
            WHERE sga."seriesId" = s."id"
              AND (
                lower(sg."name") LIKE ${prefix} ESCAPE '\\'
                OR lower(sg."slug") LIKE ${prefix} ESCAPE '\\'
              )
          )
        )
      ORDER BY "score" DESC, s."publishedAt" DESC NULLS LAST, s."id" ASC
      LIMIT ${limit}
    `);
  }

  private movieCandidates(query: string, prefix: string, fuzzy: boolean, limit: number) {
    return this.database.client.$queryRaw<SearchCandidateRow[]>(Prisma.sql`
      SELECT
        m."id"::text AS "id",
        'MOVIE'::text AS "type",
        m."slug"::text AS "slug",
        (
          CASE
            WHEN lower(m."title") = lower(${query}) THEN 132
            WHEN lower(m."title") LIKE ${prefix} ESCAPE '\\' THEN 100
            ELSE 0
          END
          + CASE WHEN ${fuzzy}::boolean
              THEN similarity(lower(m."title"), lower(${query})) * 32
              ELSE 0 END
          + ts_rank_cd(
              to_tsvector('simple', coalesce(m."title", '') || ' ' || coalesce(m."synopsis", '')),
              plainto_tsquery('simple', ${query})
            ) * 24
          + CASE
              WHEN EXISTS (
                SELECT 1
                FROM "MovieGenreAssignment" mga
                JOIN "MovieGenre" mg ON mg."id" = mga."genreId"
                WHERE mga."movieId" = m."id"
                  AND (lower(mg."name") = lower(${query}) OR lower(mg."slug") = lower(${query}))
              ) THEN 26
              WHEN EXISTS (
                SELECT 1
                FROM "MovieGenreAssignment" mga
                JOIN "MovieGenre" mg ON mg."id" = mga."genreId"
                WHERE mga."movieId" = m."id"
                  AND (
                    lower(mg."name") LIKE ${prefix} ESCAPE '\\'
                    OR lower(mg."slug") LIKE ${prefix} ESCAPE '\\'
                  )
              ) THEN 18
              ELSE 0
            END
        )::double precision AS "score"
      FROM "Movie" m
      WHERE m."status" = 'PUBLISHED'
        AND m."primaryVideoId" IS NOT NULL
        AND (
          lower(m."title") LIKE ${prefix} ESCAPE '\\'
          OR (${fuzzy}::boolean AND lower(m."title") % lower(${query}))
          OR to_tsvector(
              'simple',
              coalesce(m."title", '') || ' ' || coalesce(m."synopsis", '')
            ) @@ plainto_tsquery('simple', ${query})
          OR EXISTS (
            SELECT 1
            FROM "MovieGenreAssignment" mga
            JOIN "MovieGenre" mg ON mg."id" = mga."genreId"
            WHERE mga."movieId" = m."id"
              AND (
                lower(mg."name") LIKE ${prefix} ESCAPE '\\'
                OR lower(mg."slug") LIKE ${prefix} ESCAPE '\\'
              )
          )
        )
      ORDER BY "score" DESC, m."publishedAt" DESC NULLS LAST, m."id" ASC
      LIMIT ${limit}
    `);
  }
}

export function escapeLikePrefix(value: string): string {
  return `${value.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
}

function mergeCandidateRows(rows: SearchCandidateRow[]): SearchCandidate[] {
  const byKey = new Map<string, SearchCandidate>();
  for (const row of rows) {
    const type = row.type as SearchCandidateType;
    const score = Number(row.score);
    if (!candidateTypes.has(type) || !row.id || !Number.isFinite(score)) continue;
    const key = `${type}:${row.id}`;
    const current = byKey.get(key);
    if (!current || current.score < score) {
      byKey.set(key, { id: row.id, type, slug: row.slug ?? null, score });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
  );
}
