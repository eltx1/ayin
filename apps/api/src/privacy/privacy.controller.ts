import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z, type ZodType } from "zod";

import {
  AdminGuard,
  RequireAdminRoles,
  RequireAdminStepUp,
  type AdminAuthenticatedRequest,
} from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthRateLimiter } from "../auth/auth-rate-limiter.js";
import { badRequest, unauthorized } from "../auth/auth.errors.js";
import { PrivacyExportService } from "./privacy-export.service.js";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  PrivacyLifecycleService,
} from "./privacy-lifecycle.service.js";

const deletionRequestSchema = z
  .object({
    password: z.string().min(1).max(128),
    confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION),
  })
  .strict();
const recoverySchema = z.object({ reason: z.string().trim().min(10).max(1_000) }).strict();
const accountIdSchema = z.uuid();

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest("INVALID_PRIVACY_REQUEST", "The privacy request is invalid.");
  }
  return result.data;
}

@Controller("privacy")
export class PrivacyController {
  constructor(
    @Inject(PrivacyExportService) private readonly exporter: PrivacyExportService,
    @Inject(PrivacyLifecycleService) private readonly lifecycle: PrivacyLifecycleService,
    @Inject(AuthRateLimiter) private readonly rateLimiter: AuthRateLimiter,
  ) {}

  @Get("export")
  @UseGuards(AuthGuard)
  async downloadMyData(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimiter.consume("privacy-export", request.ayinAuth.accountId);
    const exportData = await this.exporter.build(request.ayinAuth.accountId);
    if (!exportData) throw unauthorized();
    const date = new Date().toISOString().slice(0, 10);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="ayin-data-export-${date}.json"`);
    reply.header("cache-control", "no-store, private");
    return exportData;
  }

  @Get("deletion")
  @UseGuards(AuthGuard)
  deletionStatus(@Req() request: AuthenticatedRequest) {
    return this.lifecycle.status(request.ayinAuth.accountId);
  }

  @Post("deletion")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  requestDeletion(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    this.rateLimiter.consume("privacy-deletion-request", request.ayinAuth.accountId);
    return this.lifecycle.requestDeletion(
      request.ayinAuth.accountId,
      request.ayinAuth.sessionId,
      parseBody(deletionRequestSchema, body),
    );
  }

  @Post("deletion/cancel")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  cancelDeletion(@Req() request: AuthenticatedRequest) {
    this.rateLimiter.consume("privacy-deletion-cancel", request.ayinAuth.accountId);
    return this.lifecycle.cancelDeletion(request.ayinAuth.accountId);
  }
}

@Controller("admin/privacy")
export class AdminPrivacyController {
  constructor(
    @Inject(PrivacyLifecycleService) private readonly lifecycle: PrivacyLifecycleService,
    @Inject(AuthRateLimiter) private readonly rateLimiter: AuthRateLimiter,
  ) {}

  @Post("deletions/:accountId/recover")
  @UseGuards(AuthGuard, AdminGuard)
  @RequireAdminRoles("SUPERADMIN")
  @RequireAdminStepUp()
  @HttpCode(HttpStatus.OK)
  recoverDeletion(
    @Req() request: AdminAuthenticatedRequest,
    @Param("accountId") accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = accountIdSchema.safeParse(accountIdRaw);
    if (!parsed.success) throw badRequest("INVALID_ACCOUNT_ID", "Invalid account identifier.");
    this.rateLimiter.consume("privacy-admin-recover", request.ayinAuth.accountId);
    const input = parseBody(recoverySchema, body);
    return this.lifecycle.adminRecover(request.ayinAuth.accountId, parsed.data, input.reason);
  }
}
