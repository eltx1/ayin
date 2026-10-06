import { MediaUploadRecoveryCommandsService } from "./media-upload-recovery-commands.service.js";
import {
  authorizeRecoveredUploadSchema,
  resumeUploadSchema,
  uploadRecoveryCommandSchema,
} from "./media-upload-recovery.validation.js";
import {
  Body,
  Post,
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
    @Inject(MediaUploadRecoveryCommandsService)
    private readonly commands: MediaUploadRecoveryCommandsService,
    @Inject(UploadRateLimiter) private readonly rateLimiter: UploadRateLimiter,
  ) {}

  @Get("capability")
  @Header("Cache-Control", "private, no-store")
  capability(@Query() query: unknown) {
    if (!z.object({}).strict().safeParse(query).success)
      throw new HttpException("Invalid upload capability request.", 400);
    return this.commands.capability();
  }

  @Get(":sessionId/operations/:requestId")
  @Header("Cache-Control", "private, no-store")
  async operationOutcome(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Param("requestId") requestId: string,
    @Query() query: unknown,
  ) {
    if (
      !z.string().uuid().safeParse(sessionId).success ||
      !z.string().uuid().safeParse(requestId).success ||
      !z.object({}).strict().safeParse(query).success
    )
      throw new HttpException("Invalid saved upload outcome request.", 400);
    try {
      this.rateLimiter.consume(`recovery-outcome:${request.ayinAuth.accountId}`);
      return await this.commands.operationOutcome(
        request.ayinAuth,
        sessionId.toLowerCase(),
        requestId.toLowerCase(),
      );
    } catch (failure) {
      if (failure instanceof MediaUploadError)
        throw new HttpException(
          { error: { code: failure.code, message: failure.message } },
          failure.statusCode,
        );
      throw failure;
    }
  }

  @Post(":sessionId/resume")
  @Header("Cache-Control", "private, no-store")
  resume(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, sessionId, body, resumeUploadSchema, (id, input) =>
      this.commands.resume(request.ayinAuth, id, input),
    );
  }
  @Post(":sessionId/authorize")
  @Header("Cache-Control", "private, no-store")
  authorize(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, sessionId, body, authorizeRecoveredUploadSchema, (id, input) =>
      this.commands.authorize(request.ayinAuth, id, input),
    );
  }
  @Post(":sessionId/complete")
  @Header("Cache-Control", "private, no-store")
  complete(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, sessionId, body, uploadRecoveryCommandSchema, (id, input) =>
      this.commands.complete(request.ayinAuth, id, input),
    );
  }
  @Post(":sessionId/cancel")
  @Header("Cache-Control", "private, no-store")
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, sessionId, body, uploadRecoveryCommandSchema, (id, input) =>
      this.commands.cancel(request.ayinAuth, id, input),
    );
  }
  private async command<T>(
    request: AuthenticatedRequest,
    sessionId: string,
    body: unknown,
    schema: z.ZodType<T>,
    run: (id: string, input: T) => Promise<unknown>,
  ) {
    const parsed = schema.safeParse(body);
    if (
      !z.string().uuid().safeParse(sessionId).success ||
      !parsed.success ||
      !z.object({}).strict().safeParse(request.query).success
    )
      throw new HttpException(
        { error: { code: "INVALID_UPLOAD_COMMAND", message: "Check the saved upload command." } },
        400,
      );
    try {
      this.rateLimiter.consume(`recovery-command:${request.ayinAuth.accountId}`);
      return await run(sessionId.toLowerCase(), parsed.data);
    } catch (failure) {
      if (failure instanceof MediaUploadError)
        throw new HttpException(
          { error: { code: failure.code, message: failure.message } },
          failure.statusCode,
        );
      throw failure;
    }
  }

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
