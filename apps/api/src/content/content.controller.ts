import { Controller, Get, HttpException, Inject, Param } from "@nestjs/common";

import { WatchError } from "../watch/watch.service.js";
import { ContentService, type VideoContentDetailResponse } from "./content.service.js";

@Controller("public/content")
export class ContentController {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  @Get("videos/:slug")
  async video(@Param("slug") slug: string): Promise<VideoContentDetailResponse> {
    try {
      return await this.content.getVideoDetail(slug);
    } catch (error) {
      if (error instanceof WatchError) {
        throw new HttpException(
          { error: { code: error.code, message: error.message } },
          error.statusCode,
        );
      }
      throw error instanceof Error ? error : new Error("Unexpected content detail error.");
    }
  }
}
