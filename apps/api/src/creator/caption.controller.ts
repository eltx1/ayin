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
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { CaptionError, CaptionService } from "./caption.service.js";
import {
  captionPatchSchema,
  captionReplacementSchema,
  captionUploadSchema,
} from "./caption.validation.js";

const uuidSchema = z.string().uuid();

@Controller("creator/studio/videos/:videoId/captions")
@UseGuards(AuthGuard)
export class CaptionController {
  constructor(@Inject(CaptionService) private readonly captions: CaptionService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    return this.run(() => this.captions.list(request.ayinAuth.accountId, this.id(videoIdRaw)));
  }

  @Post("uploads")
  prepare(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = captionUploadSchema.safeParse(body);
    if (!parsed.success) this.invalid(parsed.error.issues[0]?.message);
    return this.run(() =>
      this.captions.prepareCreate(request.ayinAuth.accountId, this.id(videoIdRaw), parsed.data),
    );
  }

  @Post(":trackId/uploads")
  replace(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Param("trackId") trackIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = captionReplacementSchema.safeParse(body);
    if (!parsed.success) this.invalid(parsed.error.issues[0]?.message);
    return this.run(() =>
      this.captions.prepareReplacement(
        request.ayinAuth.accountId,
        this.id(videoIdRaw),
        this.id(trackIdRaw),
        parsed.data,
      ),
    );
  }

  @Post(":trackId/finalize")
  finalize(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Param("trackId") trackIdRaw: string,
  ) {
    return this.run(() =>
      this.captions.finalize(request.ayinAuth.accountId, this.id(videoIdRaw), this.id(trackIdRaw)),
    );
  }

  @Patch(":trackId")
  patch(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Param("trackId") trackIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = captionPatchSchema.safeParse(body);
    if (!parsed.success) this.invalid(parsed.error.issues[0]?.message);
    return this.run(() =>
      this.captions.patch(
        request.ayinAuth.accountId,
        this.id(videoIdRaw),
        this.id(trackIdRaw),
        parsed.data,
      ),
    );
  }

  @Delete(":trackId")
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Param("trackId") trackIdRaw: string,
  ) {
    return this.run(() =>
      this.captions.remove(request.ayinAuth.accountId, this.id(videoIdRaw), this.id(trackIdRaw)),
    );
  }

  private id(raw: string): string {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success)
      throw this.httpError(new CaptionError("INVALID_ID", "This caption link is invalid."));
    return parsed.data;
  }

  private invalid(message?: string): never {
    throw this.httpError(
      new CaptionError(
        "INVALID_CAPTION_INPUT",
        message ?? "Check the caption settings and try again.",
      ),
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.httpError(error);
    }
  }

  private httpError(error: unknown): Error {
    if (error instanceof CaptionError) {
      return new HttpException(
        { error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    return error instanceof Error ? error : new Error("Unexpected caption-management error.");
  }
}
