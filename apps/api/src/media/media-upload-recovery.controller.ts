import {
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { MediaUploadError } from "./media-upload.service.js";
import { MediaUploadRecoveryService } from "./media-upload-recovery.service.js";
import { UploadRateLimiter } from "./upload-rate-limiter.js";

@Controller("media/uploads/sessions")
@UseGuards(AuthGuard)
export class MediaUploadRecoveryController {
  constructor(
    @Inject(MediaUploadRecoveryService) private readonly recovery: MediaUploadRecoveryService,
    @Inject(UploadRateLimiter) private readonly rateLimiter: UploadRateLimiter,
  ) {}

  @Get(":sessionId/inspection")
  @Header("Cache-Control", "private, no-store")
  async inspect(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Query() query: unknown,
  ) {
    if (
      !z.string().uuid().safeParse(sessionId).success ||
      !z.object({}).strict().safeParse(query).success
    )
      throw new HttpException("Invalid saved upload inspection request.", 400);
    try {
      this.rateLimiter.consume(`inspect:${request.ayinAuth.accountId}`);
      return await this.recovery.inspect(request.ayinAuth, sessionId);
    } catch (error) {
      if (error instanceof MediaUploadError)
        throw new HttpException(
          { error: { code: error.code, message: error.message } },
          error.statusCode,
        );
      throw error;
    }
  }
}
