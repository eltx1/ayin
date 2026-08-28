import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { MediaStorageUnavailableError } from "./media-storage.adapter.js";
import { MediaUploadError, MediaUploadService } from "./media-upload.service.js";

const createSessionSchema = z.object({
  channelId: z.string().uuid(),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(255),
});

const sessionSchema = z.object({ sessionToken: z.string().min(20) });
const partSchema = sessionSchema.extend({ partNumber: z.number().int().positive() });
const completeSchema = sessionSchema.extend({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().trim().min(1).max(256),
      }),
    )
    .max(10_000),
});

@Controller("media/uploads")
@UseGuards(AuthGuard)
export class MediaUploadController {
  constructor(@Inject(MediaUploadService) private readonly uploads: MediaUploadService) {}

  @Post("sessions")
  async createSession(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new MediaUploadError(
          "INVALID_UPLOAD_REQUEST",
          parsed.error.issues[0]?.message ?? "The selected video could not be prepared for upload.",
        ),
      );
    }
    return this.run(() => this.uploads.createSession(request.ayinAuth.accountId, parsed.data));
  }

  @Post("sessions/authorize-part")
  async authorizePart(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = partSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new MediaUploadError("INVALID_PART_REQUEST", "That video part could not be authorized."),
      );
    }
    return this.run(() =>
      this.uploads.authorizePart(
        request.ayinAuth.accountId,
        parsed.data.sessionToken,
        parsed.data.partNumber,
      ),
    );
  }

  @Post("sessions/complete")
  async complete(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(
        new MediaUploadError("INVALID_COMPLETION", "The upload completion data is incomplete."),
      );
    }
    return this.run(() =>
      this.uploads.complete(request.ayinAuth.accountId, parsed.data.sessionToken, parsed.data.parts),
    );
  }

  @Post("sessions/abort")
  async abort(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) {
      throw this.httpError(new MediaUploadError("INVALID_ABORT", "This upload could not be stopped."));
    }
    return this.run(() => this.uploads.abort(request.ayinAuth.accountId, parsed.data.sessionToken));
  }

  @Get("sessions/:sessionToken/parts")
  async resumeParts(
    @Req() request: AuthenticatedRequest,
    @Param("sessionToken") sessionToken: string,
  ) {
    return this.run(() => this.uploads.resumeParts(request.ayinAuth.accountId, sessionToken));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.httpError(error);
    }
  }

  private httpError(error: unknown): Error {
    if (error instanceof MediaUploadError) {
      return new HttpException({ error: { code: error.code, message: error.message } }, error.statusCode);
    }
    if (error instanceof MediaStorageUnavailableError) {
      return new HttpException(
        { error: { code: "R2_NOT_CONFIGURED", message: error.message } },
        503,
      );
    }
    return error instanceof Error ? error : new Error("Unexpected media upload error.");
  }
}
