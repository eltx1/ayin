import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { VideoAdService, adEventSchema } from "./video-ad.service.js";

const uuid = z.string().uuid();
const overrideDirectorySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).optional(),
    query: z.string().trim().max(200).optional(),
    targetType: z.enum(["CHANNEL", "VIDEO"]).optional(),
  })
  .strict();

@Controller("ads")
export class VideoAdController {
  constructor(
    @Inject(VideoAdService) private readonly videoAds: VideoAdService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get("video/decision/:videoId")
  @Header("Cache-Control", "private, no-store")
  async getDecision(
    @Param("videoId") videoIdRaw: string,
    @Req() request: { protocol?: string; headers?: Record<string, unknown> },
    @Headers() headers: HeaderBag,
  ) {
    const videoId = this.id(videoIdRaw);
    const host = typeof request.headers?.host === "string" ? request.headers.host : null;
    const origin = host ? `${request.protocol === "http" ? "http" : "https"}://${host}` : null;
    return this.videoAds.getDecision(videoId, origin, {
      countryCode: this.trustedRegion.countryFromHeaders(headers),
    });
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

  @Get("settings/record")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  settingsRecord() {
    return this.videoAds.settingsRecord();
  }

  @Get("overrides/directory")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  overrideDirectory(@Query() query: unknown) {
    const parsed = overrideDirectorySchema.safeParse(query);
    if (!parsed.success)
      throw new HttpException(
        {
          error: {
            code: "INVALID_AD_DIRECTORY",
            message: "Check the advertising directory filters.",
          },
        },
        400,
      );
    return this.videoAds.overrideDirectory(parsed.data);
  }

  @Get("overrides/records/:overrideId")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  overrideRecord(@Param("overrideId") id: string) {
    return this.videoAds.overrideRecord(this.id(id));
  }

  @Patch("settings")
  @RequireAdminStepUp()
  async updateSettings(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    try {
      return await this.videoAds.updateSettings(request.ayinAuth, body);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
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
  @RequireAdminStepUp()
  async updateChannelOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.videoAds.upsertOverride(
        request.ayinAuth,
        { channelId: this.id(channelIdRaw) },
        body,
      );
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      throw new HttpException(
        { error: { code: "INVALID_VIDEO_AD_OVERRIDE", message: "Check the channel ad override." } },
        400,
      );
    }
  }

  @Delete("channels/:channelId")
  @RequireAdminStepUp()
  deleteChannelOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
  ) {
    return this.videoAds.deleteOverride(request.ayinAuth, {
      channelId: this.id(channelIdRaw),
    });
  }

  @Patch("videos/:videoId")
  @RequireAdminStepUp()
  async updateVideoOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.videoAds.upsertOverride(
        request.ayinAuth,
        { videoId: this.id(videoIdRaw) },
        body,
      );
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      throw new HttpException(
        { error: { code: "INVALID_VIDEO_AD_OVERRIDE", message: "Check the video ad override." } },
        400,
      );
    }
  }

  @Delete("videos/:videoId")
  @RequireAdminStepUp()
  deleteVideoOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
  ) {
    return this.videoAds.deleteOverride(request.ayinAuth, {
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
