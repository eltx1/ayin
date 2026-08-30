import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class ClipsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async feed(cursor?: string, limit = 12) {
    const videos = await this.database.client.video.findMany({
      where: {
        videoForm: "CLIP",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        durationMs: true,
        publishedAt: true,
        channel: { select: { id: true, handle: true, name: true } },
        mediaAssets: {
          where: { kind: "SOURCE_VIDEO", status: { in: ["UPLOADED", "VALIDATED"] }, removedAt: null },
          take: 1,
          select: { id: true, r2ObjectKey: true, mimeType: true },
        },
        _count: { select: { reactions: true, comments: true } },
      },
    });
    const hasMore = videos.length > limit;
    const items = hasMore ? videos.slice(0, limit) : videos;
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      playbackPolicy: { autoplay: "active-item-only", mutedByDefault: true, preload: "metadata" },
      adPolicy: { namespace: "clips", inheritsLongFormRules: false },
    };
  }
}
