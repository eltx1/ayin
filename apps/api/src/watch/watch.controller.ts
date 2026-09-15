import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { WatchError, WatchService } from "./watch.service.js";

const uuidSchema = z.string().uuid();
const progressBodySchema = z
  .object({
    profileId: uuidSchema.optional(),
    positionMs: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60 * 60 * 1000),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1000)
      .optional(),
  })
  .strict();
const progressQuerySchema = z.object({ profileId: uuidSchema.optional() }).strict();

@Controller("public/videos")
export class PublicWatchController {
  constructor(
    @Inject(WatchService) private readonly watch: WatchService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get(":slug/playback")
  async playback(
    @Param("slug") slug: string,
    @Query("kids") kids: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    return runWatchOperation(() =>
      this.watch.getPublicPlayback(
        slug,
        this.trustedRegion.countryFromHeaders(headers),
        kids === "1",
      ),
    );
  }
}

@Controller("watch")
@UseGuards(AuthGuard)
export class WatchProgressController {
  constructor(
    @Inject(WatchService) private readonly watch: WatchService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get("progress/:videoId")
  async progress(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const videoId = parseUuid(videoIdRaw);
    const parsed = progressQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw watchHttpError(
        new WatchError("INVALID_PROFILE", "The selected viewer profile is invalid."),
      );
    }
    return runWatchOperation(() =>
      this.watch.getProgress(
        request.ayinAuth.accountId,
        videoId,
        parsed.data.profileId,
        this.trustedRegion.countryFromHeaders(headers),
      ),
    );
  }

  @Put("progress/:videoId")
  async saveProgress(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const videoId = parseUuid(videoIdRaw);
    const parsed = progressBodySchema.safeParse(body);
    if (!parsed.success) {
      throw watchHttpError(new WatchError("INVALID_PROGRESS", "The playback position is invalid."));
    }
    return runWatchOperation(() =>
      this.watch.saveProgress(
        request.ayinAuth.accountId,
        videoId,
        parsed.data,
        this.trustedRegion.countryFromHeaders(headers),
      ),
    );
  }
}

function parseUuid(raw: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw watchHttpError(new WatchError("INVALID_VIDEO_ID", "This video link is invalid."));
  }
  return parsed.data;
}

async function runWatchOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw watchHttpError(error);
  }
}

function watchHttpError(error: unknown): Error {
  if (error instanceof WatchError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected watch-state error.");
}
