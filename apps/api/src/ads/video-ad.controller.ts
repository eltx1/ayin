import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { VideoAdService, adEventSchema } from "./video-ad.service.js";

const uuid = z.string().uuid();

@Controller("ads")
export class VideoAdController {
  constructor(@Inject(VideoAdService) private readonly videoAds: VideoAdService) {}

  @Get("video/decision/:videoId")
  async getDecision(
    @Param("videoId") videoIdRaw: string,
    @Req() request: { protocol?: string; headers?: Record<string, unknown> },
  ) {
    const videoId = this.id(videoIdRaw);
    const host = typeof request.headers?.host === "string" ? request.headers.host : null;
    const origin = host ? `${request.protocol === "http" ? "http" : "https"}://${host}` : null;
    return this.videoAds.getDecision(videoId, origin);
  }

  @Post("video/events")
  async recordEvent(@Body() body: unknown) {
    const parsed = adEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_AD_EVENT", message: "Invalid ad event." } },
        400,
      );
    }
    return this.videoAds.recordEvent(parsed.data);
  }

  @Get("house/vast")
  @Header("content-type", "application/xml; charset=utf-8")
  async houseVast() {
    const vast = this.videoAds.getHouseVast(await this.videoAds.getSettings());
    if (!vast) {
      throw new HttpException(
        {
          error: {
            code: "HOUSE_CREATIVE_NOT_CONFIGURED",
            message: "No AYIN-owned house creative is configured.",
          },
        },
        503,
      );
    }
    return vast;
  }

  private id(value: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_VIDEO_ID", message: "Invalid video ID." } },
        400,
      );
    }
    return parsed.data;
  }
}

@Controller("admin/video-ads")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("AD_MANAGER")
export class AdminVideoAdController {
  constructor(@Inject(VideoAdService) private readonly videoAds: VideoAdService) {}

  @Get("settings")
  getSettings() {
    return this.videoAds.getSettings();
  }

  @Patch("settings")
  async updateSettings(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    try {
      return await this.videoAds.updateSettings(request.ayinAuth.accountId, body);
    } catch {
      throw new HttpException(
        {
          error: {
            code: "INVALID_VIDEO_AD_SETTINGS",
            message: "Check video advertising settings.",
          },
        },
        400,
      );
    }
  }

  @Get("overrides")
  listOverrides() {
    return this.videoAds.listOverrides();
  }

  @Patch("channels/:channelId")
  async updateChannelOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.videoAds.upsertOverride(
        request.ayinAuth.accountId,
        { channelId: this.id(channelIdRaw) },
        body,
      );
    } catch {
      throw new HttpException(
        { error: { code: "INVALID_VIDEO_AD_OVERRIDE", message: "Check the channel ad override." } },
        400,
      );
    }
  }

  @Delete("channels/:channelId")
  deleteChannelOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
  ) {
    return this.videoAds.deleteOverride(request.ayinAuth.accountId, {
      channelId: this.id(channelIdRaw),
    });
  }

  @Patch("videos/:videoId")
  async updateVideoOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.videoAds.upsertOverride(
        request.ayinAuth.accountId,
        { videoId: this.id(videoIdRaw) },
        body,
      );
    } catch {
      throw new HttpException(
        { error: { code: "INVALID_VIDEO_AD_OVERRIDE", message: "Check the video ad override." } },
        400,
      );
    }
  }

  @Delete("videos/:videoId")
  deleteVideoOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
  ) {
    return this.videoAds.deleteOverride(request.ayinAuth.accountId, {
      videoId: this.id(videoIdRaw),
    });
  }

  private id(value: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_ID", message: "Invalid resource ID." } },
        400,
      );
    }
    return parsed.data;
  }
}
