import { Prisma } from "@ayin/db";
import {
  availableVideoPolicySql,
  publicPlayableVideoSql,
} from "../video-policy/video-policy-query.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";

export function publicVideoEligibility(context: VideoPolicyContext) {
  return Prisma.sql`(${publicPlayableVideoSql()}) AND (${availableVideoPolicySql(Prisma.sql`v.id`, context)})`;
}

export const publicVideoSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  durationMs: true,
  publishedAt: true,
  mediaAssets: {
    where: { kind: "THUMBNAIL", status: { in: ["UPLOADED", "VALIDATED"] }, removedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { r2ObjectKey: true, mimeType: true },
  },
} satisfies Prisma.VideoSelect;
