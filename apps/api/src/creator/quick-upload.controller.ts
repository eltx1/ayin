import {
  Body,
  Controller,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { MediaStorageUnavailableError } from "../media/media-storage.adapter.js";
import { MediaUploadError } from "../media/media-upload.service.js";
import { QuickUploadError, QuickUploadService } from "./quick-upload.service.js";

const videoIdSchema = z.string().uuid();
const detailsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).nullable().optional(),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
  commentsEnabled: z.boolean().optional(),
  scheduledPublishAt: z.string().datetime().nullable().optional(),
});
const createDraftSchema = z.object({
  channelId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(255),
  durationMs: z.number().int().positive().nullable().optional(),
});
const publishSchema = detailsSchema.extend({ rightsConfirmed: z.boolean() });
const thumbnailAuthorizeSchema = z.object({
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
const thumbnailCompleteSchema = z.object({ assetId: z.string().uuid() });

@Controller("creator/videos")
@UseGuards(AuthGuard)
export class QuickUploadController {
  constructor(@Inject(QuickUploadService) private readonly quickUpload: QuickUploadService) {}

  @Post("drafts")
  async createDraft(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new QuickUploadError(
          "INVALID_DRAFT_REQUEST",
          parsed.error.issues[0]?.message ?? "This video could not be prepared for upload.",
        ),
      );
    }
    return this.run(() =>
      this.quickUpload.createDraft(request.ayinAuth.accountId, {
        ...parsed.data,
        durationMs: parsed.data.durationMs ?? null,
      }),
    );
  }

  @Post(":videoId/upload-complete")
  async confirmUpload(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    const videoId = this.videoId(videoIdRaw);
    return this.run(() => this.quickUpload.confirmUpload(request.ayinAuth.accountId, videoId));
  }

  @Patch(":videoId")
  async updateDetails(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const videoId = this.videoId(videoIdRaw);
    const parsed = detailsSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new QuickUploadError("INVALID_VIDEO_DETAILS", "Check the video details and try again."),
      );
    }
    return this.run(() =>
      this.quickUpload.updateDetails(
        request.ayinAuth.accountId,
        videoId,
        this.parseDetails(parsed.data),
      ),
    );
  }

  @Post(":videoId/publish")
  async publish(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const videoId = this.videoId(videoIdRaw);
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new QuickUploadError("INVALID_PUBLISH_REQUEST", "Check the publish details and try again."),
      );
    }
    const { rightsConfirmed, ...details } = parsed.data;
    return this.run(() =>
      this.quickUpload.publish(
        request.ayinAuth.accountId,
        videoId,
        rightsConfirmed,
        this.parseDetails(details),
      ),
    );
  }

  @Post(":videoId/thumbnail/authorize")
  async authorizeThumbnail(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const videoId = this.videoId(videoIdRaw);
    const parsed = thumbnailAuthorizeSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new QuickUploadError("INVALID_THUMBNAIL_REQUEST", "This thumbnail could not be prepared."),
      );
    }
    return this.run(() =>
      this.quickUpload.authorizeThumbnail(request.ayinAuth.accountId, videoId, parsed.data),
    );
  }

  @Post(":videoId/thumbnail/complete")
  async completeThumbnail(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const videoId = this.videoId(videoIdRaw);
    const parsed = thumbnailCompleteSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new QuickUploadError(
          "INVALID_THUMBNAIL_COMPLETION",
          "This thumbnail could not be completed.",
        ),
      );
    }
    return this.run(() =>
      this.quickUpload.completeThumbnail(request.ayinAuth.accountId, videoId, parsed.data.assetId),
    );
  }

  private parseDetails(input: z.infer<typeof detailsSchema>) {
    const { scheduledPublishAt, ...details } = input;
    return {
      ...details,
      ...(scheduledPublishAt !== undefined
        ? { scheduledPublishAt: scheduledPublishAt ? new Date(scheduledPublishAt) : null }
        : {}),
    };
  }

  private videoId(raw: string): string {
    const parsed = videoIdSchema.safeParse(raw);
    if (!parsed.success) {
      throw this.httpError(new QuickUploadError("INVALID_VIDEO_ID", "This video link is invalid."));
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
    if (error instanceof QuickUploadError || error instanceof MediaUploadError) {
      return new HttpException(
        { error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    if (error instanceof MediaStorageUnavailableError) {
      return new HttpException(
        { error: { code: "R2_NOT_CONFIGURED", message: error.message } },
        503,
      );
    }
    return error instanceof Error ? error : new Error("Unexpected creator video error.");
  }
}
