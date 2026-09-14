import { Controller, Get, Inject } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

@Controller("public/series-sitemap")
export class SeriesSitemapController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list() {
    const items = await this.database.client.series.findMany({
      where: {
        status: "PUBLISHED",
        seasons: {
          some: {
            episodes: { some: { status: "PUBLISHED", videoId: { not: null } } },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 50_000,
      select: { slug: true, updatedAt: true },
    });
    return { items };
  }
}
