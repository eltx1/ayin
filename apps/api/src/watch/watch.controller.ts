import {
  Body,
  Controller,
  Get,
  Header,
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
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { CatalogLocalizationService } from "../catalog-localization/catalog-localization.service.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { ViewerPolicyContextService } from "../video-policy/viewer-policy-context.service.js";
import { WatchError, WatchService } from "./watch.service.js";

const uuidSchema = z.string().uuid();
const progressBodySchema = z
  .object({
    profileId: uuidSchema.optional(),
    expectedRevision: z.iso.datetime({ precision: 3 }).nullable().optional(),
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
const playbackQuerySchema = z
  .object({
    kids: z.unknown().optional(),
    locale: z.string().trim().min(2).max(35).optional(),
    expectedProfileId: uuidSchema.optional(),
  })
  .passthrough()
  .refine(
    (query) =>
      !Object.keys(query).some((key) => key.startsWith("locale[") || key.startsWith("locale.")),
  );

@Controller("public/videos")
@UseGuards(OptionalAuthGuard)
export class PublicWatchController {
  constructor(
    @Inject(WatchService) private readonly watch: WatchService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
    @Inject(CatalogLocalizationService) private readonly localization: CatalogLocalizationService,
    @Inject(ViewerPolicyContextService) private readonly viewerContext: ViewerPolicyContextService,
  ) {}

  @Get(":slug/playback")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  async playback(
    @Req() request: { ayinAuth?: AuthenticatedRequest["ayinAuth"] },
    @Param("slug") slug: string,
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    return runWatchOperation(async () => {
      const parsed = playbackQuerySchema.safeParse(query);
      if (!parsed.success)
        throw new WatchError("INVALID_PLAYBACK_QUERY", "The playback request is invalid.");
      return this.viewerContext.run(
        {
          accountId: request.ayinAuth?.accountId,
          expectedProfileId: parsed.data.expectedProfileId,
          countryCode: this.trustedRegion.countryFromHeaders(headers),
          isKidsProfile: parsed.data.kids === "1",
        },
        async (policy) => {
          const { mediaSelection, ...playback } = await this.watch.getPublicPlayback(
            slug,
            policy.countryCode,
            policy.isKidsProfile,
          );
          const viewer = { isKids: policy.isKidsProfile === true };
          const seriesContext = playback.detail.seriesContext
            ? await this.localization.localizeSeriesContext(
                playback.detail.seriesContext,
                parsed.data.locale,
              )
            : null;
          // Policy may change while source, captions, or episode context are
          // loading. Revalidate immediately before disclosing the result.
          await this.watch.assertPlaybackStillAvailable(
            playback.video,
            mediaSelection,
            policy.countryCode,
            policy.isKidsProfile,
          );
          if (!seriesContext) return { ...playback, viewer };
          return {
            ...playback,
            viewer,
            detail: { ...playback.detail, seriesContext, nextEpisode: seriesContext.nextEpisode },
          };
        },
        () =>
          new WatchError(
            "PLAYBACK_VIEWER_CHANGED",
            "Your viewer profile changed. Refresh and try again.",
            409,
          ),
      );
    });
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
  @Header("Cache-Control", "private, no-store")
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
  @Header("Cache-Control", "private, no-store")
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
