import { Prisma } from "@ayin/db";
import { normalizeTerritoryCode } from "./country-codes.js";
import type { VideoPolicyContext } from "./video-policy.service.js";

// SQL counterpart of evaluatePolicy, for filtering before LIMIT/OFFSET. Keep the
// database parity test when changing either policy implementation. Publication,
// channel state and playable assets remain independent caller-owned boundaries.
export function availableVideoPolicySql(videoId: Prisma.Sql, context: VideoPolicyContext = {}) {
  const now = context.now ?? new Date();
  const country = normalizeTerritoryCode(context.countryCode);
  const territory = country
    ? Prisma.sql`(cardinality(p."allowedTerritories") = 0 OR ${country} = ANY(p."allowedTerritories"))
        AND NOT (${country} = ANY(p."blockedTerritories"))`
    : Prisma.sql`cardinality(p."allowedTerritories") = 0 AND cardinality(p."blockedTerritories") = 0`;
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM "VideoPolicyOverride" o WHERE o."videoId" = ${videoId}
      AND o.disposition = 'FORCE_BLOCK' AND (o."expiresAt" IS NULL OR o."expiresAt" > ${now})
    )
    AND ${
      context.isKidsProfile === true
        ? Prisma.sql`EXISTS (
      SELECT 1 FROM "VideoPolicy" p WHERE p."videoId" = ${videoId}
      AND p."kidsEligible" = TRUE AND p."maturityLevel" = 'GENERAL' AND p."ageRestriction" = 'NONE'
    )`
        : Prisma.sql`TRUE`
    }
    AND (
      EXISTS (
        SELECT 1 FROM "VideoPolicyOverride" o WHERE o."videoId" = ${videoId}
        AND o.disposition = 'FORCE_ALLOW' AND (o."expiresAt" IS NULL OR o."expiresAt" > ${now})
      )
      OR NOT EXISTS (SELECT 1 FROM "VideoPolicy" p WHERE p."videoId" = ${videoId})
      OR EXISTS (
        SELECT 1 FROM "VideoPolicy" p WHERE p."videoId" = ${videoId}
        AND (p."rightsExpiresAt" IS NULL OR p."rightsExpiresAt" > ${now}) AND ${territory}
      )
    )`;
}

// Callers bind the Video table to alias v. These hard publication/media
// boundaries cannot be bypassed by a distribution-policy FORCE_ALLOW override.
export function publicPlayableVideoSql() {
  return Prisma.sql`v.status = 'PUBLISHED' AND v.visibility = 'PUBLIC' AND v."removedAt" IS NULL
    AND EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = v."channelId"
      AND c.status = 'ACTIVE' AND c."removedAt" IS NULL)
    AND EXISTS (SELECT 1 FROM "MediaAsset" m WHERE m."videoId" = v.id
      AND m.kind = 'SOURCE_VIDEO' AND m.status = 'VALIDATED'
      AND m."removedAt" IS NULL AND m."mimeType" = 'video/mp4')`;
}
