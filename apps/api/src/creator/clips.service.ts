import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import {
  availableVideoPolicySql,
  publicPlayableVideoSql,
} from "../video-policy/video-policy-query.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";

const clipSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  durationMs: true,
  publishedAt: true,
  channel: { select: { id: true, handle: true, name: true } },
  mediaAssets: {
    where: {
      removedAt: null,
      OR: [
        { kind: "SOURCE_VIDEO", status: "VALIDATED", mimeType: "video/mp4" },
        { kind: "THUMBNAIL", status: { in: ["UPLOADED", "VALIDATED"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, r2ObjectKey: true },
  },
  _count: {
    select: {
      reactions: { where: { type: "LIKE" } },
    },
  },
} satisfies Prisma.VideoSelect;

@Injectable()
export class ClipsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async feed(input: {
    take: number;
    cursor?: string | undefined;
    countryCode?: string | undefined;
    isKidsProfile?: boolean | undefined;
  }) {
    const viewer = { isKids: input.isKidsProfile === true };
    const [enabled, autoplayEnabled, adsEnabled, adFrequency] = await Promise.all([
      this.settings.get("clipsEnabled"),
      this.settings.get("clipsAutoplayEnabled"),
      this.settings.get("clipsAdsEnabled"),
      this.settings.get("clipsAdFrequency"),
    ]);
    if (!(enabled as boolean)) {
      return {
        viewer,
        enabled: false,
        items: [],
        nextCursor: null,
        autoplayEnabled: false,
        adPolicy: { enabled: false, minimumOrganicClips: adFrequency as number },
      };
    }

    const now = new Date();
    // Policy tables deliberately have no ORM relation. Select one bounded page
    // of eligible IDs in PostgreSQL before LIMIT/cursor, then hydrate once.
    const candidates = await this.database.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT v.id
      FROM "Video" v
      WHERE v."videoForm" = 'CLIP'
        AND v."publishedAt" <= ${now}
        AND (${publicPlayableVideoSql()})
        AND (${availableVideoPolicySql(Prisma.sql`v.id`, {
          countryCode: input.countryCode,
          isKidsProfile: viewer.isKids,
          now,
        })})
        AND ${
          input.cursor
            ? Prisma.sql`EXISTS (
                SELECT 1
                FROM "Video" anchor
                WHERE anchor.id = ${input.cursor}::uuid
                  AND anchor."videoForm" = 'CLIP'
                  AND anchor."publishedAt" IS NOT NULL
                  AND (v."publishedAt", v.id) < (anchor."publishedAt", anchor.id)
              )`
            : Prisma.sql`TRUE`
        }
      ORDER BY v."publishedAt" DESC, v.id DESC
      LIMIT ${input.take + 1}
    `);

    const pageIds = candidates.slice(0, input.take).map((row) => row.id);
    const hasMore = candidates.length > input.take;
    const policy = {
      enabled: !viewer.isKids && (adsEnabled as boolean),
      minimumOrganicClips: adFrequency as number,
    };
    if (!pageIds.length) {
      return {
        viewer,
        enabled: true,
        items: [],
        nextCursor: null,
        autoplayEnabled: autoplayEnabled as boolean,
        adPolicy: policy,
      };
    }

    // Re-check hard publication/playability state during hydration. Policy was already
    // enforced before LIMIT above; the final policy read is defense-in-depth only for
    // a concurrent rights/override change between the SQL selection and hydration.
    const rows = await this.database.client.video.findMany({
      where: {
        id: { in: pageIds },
        videoForm: "CLIP",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: { lte: now },
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            removedAt: null,
            mimeType: "video/mp4",
          },
        },
      },
      select: clipSelect,
    });
    const allowed = await this.videoPolicy.filterAvailableVideoIds(
      rows.map((row) => row.id),
      { countryCode: input.countryCode, isKidsProfile: viewer.isKids, now: new Date() },
    );
    const selected = rows.filter((row) => allowed.has(row.id));
    const selectedAssets = selected.flatMap((row) =>
      row.mediaAssets.map(
        (asset) =>
          Prisma.sql`(${row.id}::uuid, ${asset.id}::uuid, ${asset.r2ObjectKey}, ${asset.kind})`,
      ),
    );
    // The response contains playable object keys. After hydration/policy work,
    // revalidate the exact selected assets, publication/channel and policy at a
    // fresh point in time. Another playable source cannot rescue a revoked one.
    const finalNow = new Date();
    const currentAssets = selectedAssets.length
      ? await this.database.client.$queryRaw<Array<{ assetId: string }>>(Prisma.sql`
          SELECT m.id AS "assetId"
          FROM (VALUES ${Prisma.join(selectedAssets)}) AS selected("videoId", "assetId", "objectKey", kind)
          JOIN "Video" v ON v.id = selected."videoId"
          JOIN "MediaAsset" m ON m.id = selected."assetId" AND m."videoId" = v.id
            AND m."r2ObjectKey" = selected."objectKey"
            AND m.kind::text = selected.kind
          WHERE v."videoForm" = 'CLIP'
            AND v."publishedAt" <= ${finalNow}
            AND (${publicPlayableVideoSql()})
            AND (${availableVideoPolicySql(Prisma.sql`v.id`, {
              countryCode: input.countryCode,
              isKidsProfile: viewer.isKids,
              now: finalNow,
            })})
            AND m."removedAt" IS NULL
            AND (
              (m.kind = 'SOURCE_VIDEO' AND m.status = 'VALIDATED' AND m."mimeType" = 'video/mp4')
              OR (m.kind = 'THUMBNAIL' AND m.status IN ('UPLOADED', 'VALIDATED'))
            )
        `)
      : [];
    const currentAssetIds = new Set(currentAssets.map((asset) => asset.assetId));
    const byId = new Map(
      selected.flatMap((row) => {
        const source = row.mediaAssets.find((asset) => asset.kind === "SOURCE_VIDEO");
        if (!source || !currentAssetIds.has(source.id)) return [];
        return [
          [
            row.id,
            {
              ...row,
              mediaAssets: row.mediaAssets
                .filter((asset) => currentAssetIds.has(asset.id))
                .map(({ kind, r2ObjectKey }) => ({ kind, r2ObjectKey })),
            },
          ] as const,
        ];
      }),
    );
    const items = pageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });

    return {
      viewer,
      enabled: true,
      items,
      nextCursor: hasMore ? (pageIds.at(-1) ?? null) : null,
      autoplayEnabled: autoplayEnabled as boolean,
      adPolicy: policy,
    };
  }
}
