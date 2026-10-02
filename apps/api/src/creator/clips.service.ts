import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import {
  availableVideoPolicySql,
  publicPlayableVideoSql,
} from "../video-policy/video-policy-query.js";

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
    select: { kind: true, r2ObjectKey: true },
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
  ) {}

  async feed(input: {
    take: number;
    cursor?: string | undefined;
    countryCode?: string | undefined;
  }) {
    const [enabled, autoplayEnabled, adsEnabled, adFrequency] = await Promise.all([
      this.settings.get("clipsEnabled"),
      this.settings.get("clipsAutoplayEnabled"),
      this.settings.get("clipsAdsEnabled"),
      this.settings.get("clipsAdFrequency"),
    ]);
    if (!(enabled as boolean)) {
      return {
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
      enabled: adsEnabled as boolean,
      minimumOrganicClips: adFrequency as number,
    };
    if (!pageIds.length) {
      return {
        enabled: true,
        items: [],
        nextCursor: null,
        autoplayEnabled: autoplayEnabled as boolean,
        adPolicy: policy,
      };
    }

    // Re-check only hard publication/playability state during hydration. VideoPolicy
    // is already enforced before LIMIT above; filtering it again here could create
    // short pages and reintroduce the pagination defect this query prevents.
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
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = pageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });

    return {
      enabled: true,
      items,
      nextCursor: hasMore ? (pageIds.at(-1) ?? null) : null,
      autoplayEnabled: autoplayEnabled as boolean,
      adPolicy: policy,
    };
  }
}
