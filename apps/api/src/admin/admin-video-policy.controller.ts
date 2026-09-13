import { Body, Controller, Delete, Get, Inject, Param, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";
import { AdminVideoPolicyService } from "./admin-video-policy.service.js";

const videoIdSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(1000);
const overrideSchema = z
  .object({
    disposition: z.enum(["FORCE_ALLOW", "FORCE_BLOCK"]),
    reason: reasonSchema,
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const clearSchema = z.object({ reason: reasonSchema }).strict();

@Controller("admin/video-policies")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR")
export class AdminVideoPolicyController {
  constructor(
    @Inject(AdminVideoPolicyService) private readonly policies: AdminVideoPolicyService,
  ) {}

  @Get(":videoId")
  async get(@Param("videoId") videoIdRaw: string) {
    return this.policies.get(parseVideoId(videoIdRaw));
  }

  @Put(":videoId/override")
  @RequireAdminStepUp()
  async setOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = overrideSchema.safeParse(body);
    if (!parsed.success)
      throw adminBadRequest(
        "INVALID_VIDEO_POLICY_OVERRIDE",
        "Check the override disposition, reason and expiry.",
      );
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw adminBadRequest(
        "INVALID_VIDEO_POLICY_OVERRIDE",
        "Override expiry must be in the future.",
      );
    }
    return this.policies.setOverride(request.ayinAuth.accountId, parseVideoId(videoIdRaw), {
      disposition: parsed.data.disposition,
      reason: parsed.data.reason,
      expiresAt,
    });
  }

  @Delete(":videoId/override")
  @RequireAdminStepUp()
  async clearOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = clearSchema.safeParse(body);
    if (!parsed.success)
      throw adminBadRequest(
        "INVALID_VIDEO_POLICY_OVERRIDE",
        "An audit reason is required to clear an override.",
      );
    return this.policies.clearOverride(
      request.ayinAuth.accountId,
      parseVideoId(videoIdRaw),
      parsed.data.reason,
    );
  }
}

function parseVideoId(raw: string) {
  const parsed = videoIdSchema.safeParse(raw);
  if (!parsed.success) throw adminBadRequest("INVALID_VIDEO_ID", "This video id is invalid.");
  return parsed.data;
}
