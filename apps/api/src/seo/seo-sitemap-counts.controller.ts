import { Controller, Get, Inject } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

const publicVideoWhere = {
  status: "PUBLISHED" as const,
  visibility: "PUBLIC" as const,
  removedAt: null,
  channel: { status: "ACTIVE" as const, removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO" as const,
      status: "VALIDATED" as const,
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
};

@Controller("public/seo")
export class SeoSitemapCountsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get("sitemap-counts")
  async counts() {
    const [videos, channels, playlists] = await Promise.all([
      this.database.client.video.count({ where: publicVideoWhere }),
      this.database.client.channel.count({ where: { status: "ACTIVE", removedAt: null } }),
      this.database.client.playlist.count({
        where: {
          visibility: "PUBLIC",
          isPublic: true,
          deletedAt: null,
          channel: { status: "ACTIVE", removedAt: null },
          items: { some: { video: publicVideoWhere } },
        },
      }),
    ]);
    return { videos, channels, playlists };
  }
}
