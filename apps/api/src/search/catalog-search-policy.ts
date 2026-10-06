import { Prisma } from "@ayin/db";
import { catalogAvailabilitySql } from "../video-policy/catalog-directory-query.js";
import {
  availableVideoPolicySql,
  publicPlayableVideoSql,
} from "../video-policy/video-policy-query.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";

// Catalog candidates must be usable before ranked candidate limits are applied.
// Keep this aligned with the public directories; hydration rechecks current rights.
export function catalogSearchEligibilitySql(
  kind: "MOVIE" | "SERIES",
  id: Prisma.Sql,
  context: VideoPolicyContext = {},
) {
  if (context.isKidsProfile) return Prisma.sql`FALSE`;
  const now = context.now ?? new Date();
  const playable =
    kind === "MOVIE"
      ? Prisma.sql`EXISTS (
        SELECT 1 FROM "Movie" search_movie JOIN "Video" v ON v.id = search_movie."primaryVideoId"
        WHERE search_movie.id = ${id} AND ${publicPlayableVideoSql()}
          AND ${availableVideoPolicySql(Prisma.sql`v.id`, { ...context, now })}
      )`
      : Prisma.sql`EXISTS (
        SELECT 1 FROM "SeriesSeason" search_season
        JOIN "SeriesEpisode" search_episode ON search_episode."seasonId" = search_season.id
        JOIN "Video" v ON v.id = search_episode."videoId"
        WHERE search_season."seriesId" = ${id} AND search_episode.status = 'PUBLISHED'
          AND (search_episode."releaseDate" IS NULL OR search_episode."releaseDate" <= ${now})
          AND ${publicPlayableVideoSql()}
          AND ${availableVideoPolicySql(Prisma.sql`v.id`, { ...context, now })}
      )`;
  return Prisma.sql`(${catalogAvailabilitySql(kind, id, context.countryCode, now)} AND ${playable})`;
}
