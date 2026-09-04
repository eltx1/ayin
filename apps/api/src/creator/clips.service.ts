import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

@Injectable()
export class ClipsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async feed(input: { take: number; cursor?: string | undefined }) {
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
    const rows = await this.database.client.video.findMany({
      where: {
        videoForm: "CLIP",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: { lte: new Date() },
        removedAt: null,
        channel: { status: "ACTIVE" },
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            removedAt: null,
            mimeType: "video/mp4",
          },
        },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.take + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
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
        _count: { select: { reactions: true, comments: true } },
      },
    });
    const hasMore = rows.length > input.take;
    const items = hasMore ? rows.slice(0, input.take) : rows;
    return {
      enabled: true,
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      autoplayEnabled: autoplayEnabled as boolean,
      adPolicy: {
        enabled: adsEnabled as boolean,
        minimumOrganicClips: adFrequency as number,
      },
    };
  }
}
