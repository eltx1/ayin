import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { AdminCommandCenterService } from "./admin-command-center.service.js";
import { AdminControlService } from "./admin-control.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, type AdminAuthenticatedRequest } from "./admin.guard.js";

const uuidSchema = z.string().uuid();
const searchSchema = z.object({ query: z.string().trim().min(2).max(200) });
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().trim().max(200).optional(),
});
const userQuerySchema = pageSchema.extend({
  status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
});
const channelQuerySchema = pageSchema.extend({
  status: z.enum(["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"]).optional(),
});
const videoQuerySchema = pageSchema.extend({
  status: z
    .enum(["DRAFT", "UPLOADING", "VALIDATING", "SCHEDULED", "PUBLISHED", "REMOVED"])
    .optional(),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
  channelId: z.string().uuid().optional(),
});
const tvQuerySchema = pageSchema.extend({
  status: z.enum(["ACTIVE", "OFF_AIR", "DISABLED"]).optional(),
});
const moderationQuerySchema = pageSchema.extend({
  status: z.enum(["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]).optional(),
});
const reasonSchema = z.string().trim().min(3).max(500).optional();
const accountPatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    reason: reasonSchema,
  })
  .strict();
const channelPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: z.enum(["ACTIVE", "HIDDEN", "SUSPENDED"]).optional(),
    isPlatformOwned: z.boolean().optional(),
    contractStatus: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "ENDED"]).optional(),
    revenueShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
    reason: reasonSchema,
  })
  .strict();
const videoPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "REMOVED"]).optional(),
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
    commentsEnabled: z.boolean().optional(),
    tvIncluded: z.boolean().optional(),
    reason: reasonSchema,
  })
  .strict();
const bulkVideoSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(["UNPUBLISH", "DISABLE_COMMENTS", "ENABLE_COMMENTS"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const tvPatchSchema = z
  .object({ status: z.enum(["ACTIVE", "OFF_AIR", "DISABLED"]), reason: reasonSchema })
  .strict();

@Controller("admin/control")
@UseGuards(AuthGuard, AdminGuard)
export class AdminControlController {
  constructor(
    @Inject(AdminControlService) private readonly control: AdminControlService,
    @Inject(AdminCommandCenterService) private readonly commandCenter: AdminCommandCenterService,
  ) {}

  @Get("dashboard")
  dashboard() {
    return this.control.dashboard();
  }

  @Get("search")
  search(@Query() raw: unknown) {
    const query = this.parse(searchSchema, raw, "INVALID_GLOBAL_SEARCH");
    return this.commandCenter.search(query.query);
  }

  @Get("health")
  health() {
    return this.commandCenter.health();
  }

  @Get("users")
  users(@Query() query: unknown) {
    return this.control.users(this.parse(userQuerySchema, query, "INVALID_USER_FILTER"));
  }

  @Patch("users/:accountId")
  updateUser(
    @Req() request: AdminAuthenticatedRequest,
    @Param("accountId") accountIdRaw: string,
    @Body() body: unknown,
  ) {
    return this.control.updateAccount(
      request.ayinAuth.accountId,
      this.id(accountIdRaw),
      this.parse(accountPatchSchema, body, "INVALID_ACCOUNT_UPDATE"),
    );
  }

  @Get("channels")
  channels(@Query() query: unknown) {
    return this.control.channels(this.parse(channelQuerySchema, query, "INVALID_CHANNEL_FILTER"));
  }

  @Patch("channels/:channelId")
  updateChannel(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    return this.control.updateChannel(
      request.ayinAuth.accountId,
      this.id(channelIdRaw),
      this.parse(channelPatchSchema, body, "INVALID_CHANNEL_UPDATE"),
    );
  }

  @Get("videos")
  videos(@Query() query: unknown) {
    return this.control.videos(this.parse(videoQuerySchema, query, "INVALID_VIDEO_FILTER"));
  }

  @Patch("videos/:videoId")
  updateVideo(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    return this.control.updateVideo(
      request.ayinAuth.accountId,
      this.id(videoIdRaw),
      this.parse(videoPatchSchema, body, "INVALID_VIDEO_UPDATE"),
    );
  }

  @Post("videos/bulk")
  bulkVideos(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.control.bulkVideos(
      request.ayinAuth.accountId,
      this.parse(bulkVideoSchema, body, "INVALID_BULK_VIDEO_UPDATE"),
    );
  }

  @Get("tv")
  tv(@Query() query: unknown) {
    return this.control.tvChannels(this.parse(tvQuerySchema, query, "INVALID_TV_FILTER"));
  }

  @Patch("tv/:tvChannelId")
  updateTv(
    @Req() request: AdminAuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
    @Body() body: unknown,
  ) {
    return this.control.updateTv(
      request.ayinAuth.accountId,
      this.id(tvChannelIdRaw),
      this.parse(tvPatchSchema, body, "INVALID_TV_UPDATE"),
    );
  }

  @Get("moderation")
  moderation(@Query() query: unknown) {
    return this.control.moderation(
      this.parse(moderationQuerySchema, query, "INVALID_MODERATION_FILTER"),
    );
  }

  private id(raw: string) {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success)
      throw adminBadRequest("INVALID_ID", "The requested resource id is invalid.");
    return parsed.data;
  }

  private parse<T extends z.ZodTypeAny>(schema: T, value: unknown, code: string): z.infer<T> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw adminBadRequest(
        code,
        parsed.error.issues[0]?.message ?? "The admin request is invalid.",
      );
    }
    return parsed.data;
  }
}
