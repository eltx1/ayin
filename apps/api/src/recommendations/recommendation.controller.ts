import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { RecommendationError, RecommendationService } from "./recommendation.service.js";

const querySchema = z.object({
  profileId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
});
const videoIdSchema = z.string().uuid();
const feedbackSchema = z.object({ profileId: z.string().uuid().optional(), videoId: z.string().uuid() });
const resetSchema = z.object({ profileId: z.string().uuid().optional() });

@Controller("recommendations")
@UseGuards(AuthGuard)
export class RecommendationController {
  constructor(@Inject(RecommendationService) private readonly recommendations: RecommendationService) {}

  @Get("home")
  home(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.run(async () => {
      const parsed = querySchema.parse(query);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.getHomeRecommendations(profileId, { limit: parsed.limit });
    });
  }

  @Get("up-next/:videoId")
  upNext(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string, @Query() query: unknown) {
    return this.run(async () => {
      const parsed = querySchema.parse(query);
      const videoId = videoIdSchema.parse(videoIdRaw);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.getUpNext(videoId, profileId);
    });
  }

  @Get("related/:videoId")
  related(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string, @Query() query: unknown) {
    return this.run(async () => {
      const parsed = querySchema.parse(query);
      const videoId = videoIdSchema.parse(videoIdRaw);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.getRelated(videoId, profileId);
    });
  }

  @Get("shorts")
  shorts(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.run(async () => {
      const parsed = querySchema.parse(query);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.getShortsFeed(profileId, { limit: parsed.limit });
    });
  }

  @Get("tv")
  tv(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.run(async () => {
      const parsed = querySchema.parse(query);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.getTvSuggestions(profileId, { limit: parsed.limit });
    });
  }

  @Post("not-interested")
  notInterested(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.run(async () => {
      const parsed = feedbackSchema.parse(body);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.markNotInterested(profileId, parsed.videoId);
    });
  }

  @Post("dismiss")
  dismiss(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.run(async () => {
      const parsed = feedbackSchema.parse(body);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.dismiss(profileId, parsed.videoId);
    });
  }

  @Post("reset")
  reset(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.run(async () => {
      const parsed = resetSchema.parse(body);
      const profileId = await this.recommendations.resolveProfile(request.ayinAuth.accountId, parsed.profileId);
      return this.recommendations.resetPersonalization(profileId);
    });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RecommendationError) {
        throw new HttpException({ error: { code: error.code, message: error.message } }, error.statusCode);
      }
      if (error instanceof z.ZodError) {
        throw new HttpException({ error: { code: "INVALID_RECOMMENDATION_REQUEST", message: "The recommendation request is invalid." } }, 400);
      }
      throw error instanceof Error ? error : new Error("Unexpected recommendation error.");
    }
  }
}
