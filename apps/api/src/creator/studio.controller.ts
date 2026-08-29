import {
  Body,
  Controller,
  Delete,
  Get,
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

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { StudioError, StudioService } from "./studio.service.js";

const uuidSchema = z.string().uuid();
const contentQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z
    .enum(["DRAFT", "UPLOADING", "VALIDATING", "SCHEDULED", "PUBLISHED", "REMOVED"])
    .optional(),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});
const videoPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20_000).nullable().optional(),
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
    commentsEnabled: z.boolean().optional(),
    tvIncluded: z.boolean().optional(),
  })
  .strict();

@Controller("creator/studio")
@UseGuards(AuthGuard)
export class StudioController {
  constructor(@Inject(StudioService) private readonly studio: StudioService) {}

  @Get("overview")
  overview(@Req() request: AuthenticatedRequest) {
    return this.run(() => this.studio.overview(request.ayinAuth.accountId));
  }

  @Get("content")
  content(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = contentQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw this.httpError(
        new StudioError("INVALID_CONTENT_FILTER", "Check the content filters and try again."),
      );
    }
    return this.run(() => this.studio.content(request.ayinAuth.accountId, parsed.data));
  }

  @Patch("videos/:videoId")
  updateVideo(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const videoId = this.videoId(videoIdRaw);
    const parsed = videoPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new StudioError("INVALID_VIDEO_UPDATE", "Check the video changes and try again."),
      );
    }
    return this.run(() =>
      this.studio.updateVideo(request.ayinAuth.accountId, videoId, parsed.data),
    );
  }

  @Post("videos/:videoId/unpublish")
  unpublish(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    return this.run(() =>
      this.studio.unpublish(request.ayinAuth.accountId, this.videoId(videoIdRaw)),
    );
  }

  @Delete("videos/:videoId")
  remove(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    return this.run(() => this.studio.remove(request.ayinAuth.accountId, this.videoId(videoIdRaw)));
  }

  @Get("comments")
  comments(@Req() request: AuthenticatedRequest) {
    return this.run(() => this.studio.comments(request.ayinAuth.accountId));
  }

  @Get("settings")
  settings(@Req() request: AuthenticatedRequest) {
    return this.run(() => this.studio.settings(request.ayinAuth.accountId));
  }

  private videoId(raw: string): string {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) {
      throw this.httpError(new StudioError("INVALID_VIDEO_ID", "This video link is invalid."));
    }
    return parsed.data;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.httpError(error);
    }
  }

  private httpError(error: unknown): Error {
    if (error instanceof StudioError) {
      return new HttpException(
        { error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    return error instanceof Error ? error : new Error("Unexpected Creator Studio error.");
  }
}
