import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { VideoMetadataService } from "../creator/video-metadata.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";

const videoIdSchema = z.string().uuid();

@Controller("admin/video-metadata")
@UseGuards(AuthGuard, AdminGuard)
export class AdminVideoMetadataController {
  constructor(@Inject(VideoMetadataService) private readonly metadata: VideoMetadataService) {}

  @Get(":videoId")
  @RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR")
  async get(@Param("videoId") videoIdRaw: string) {
    const parsed = videoIdSchema.safeParse(videoIdRaw);
    if (!parsed.success) {
      throw adminBadRequest("INVALID_VIDEO_ID", "This video id is invalid.");
    }
    const metadata = await this.metadata.readOne(parsed.data);
    if (!metadata) {
      throw adminBadRequest("VIDEO_NOT_FOUND", "This video could not be found.");
    }
    return { videoId: parsed.data, metadata };
  }
}
