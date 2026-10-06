import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";
import { ContentSeedingService } from "./content-seeding.service.js";
import { MediaUploadError } from "../media/media-upload.service.js";

const uuidSchema = z.string().uuid();
const seedItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).nullable().optional(),
  contentType: z.enum(["CREATOR_VIDEO", "MOVIE", "DOCUMENTARY"]),
  visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]).optional(),
  rightsBasis: z.enum(["OWNED", "LICENSED", "AUTHORIZED", "PUBLIC_DOMAIN", "OTHER"]),
  sourceNotes: z.string().trim().min(3).max(10_000),
});
const createBatchSchema = z.object({
  channelId: uuidSchema,
  sourceLabel: z.string().trim().min(2).max(200),
  items: z.array(seedItemSchema).min(1).max(100),
});
const uploadSchema = z.object({
  sizeBytes: z.number().int().positive(),
  mimeType: z.literal("video/mp4"),
  durationMs: z.number().int().positive().nullable().optional(),
});
const listSchema = z.object({ take: z.coerce.number().int().min(1).max(100).default(50) });

@Controller("admin/content-seeding")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR")
export class ContentSeedingController {
  constructor(@Inject(ContentSeedingService) private readonly seeding: ContentSeedingService) {}

  @Get("channels")
  async channels() {
    return { items: await this.seeding.listChannels() };
  }

  @Get("batches")
  list(@Query() query: unknown) {
    const parsed = this.parse(listSchema, query, "INVALID_SEED_LIST");
    return this.seeding.listBatches(parsed.take);
  }

  @Get("batches/:batchId")
  getBatch(@Param("batchId") batchIdRaw: string) {
    return this.seeding.getBatch(this.id(batchIdRaw));
  }

  @Post("batches")
  @RequireAdminStepUp()
  createBatch(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.seeding.createBatch(
      request.ayinAuth.accountId,
      this.parse(createBatchSchema, body, "INVALID_SEED_BATCH"),
    );
  }

  @Post("items/:itemId/upload-session")
  @RequireAdminStepUp()
  createUpload(
    @Req() request: AdminAuthenticatedRequest,
    @Param("itemId") itemIdRaw: string,
    @Body() body: unknown,
  ) {
    return this.seeding
      .createUploadSession(
        request.ayinAuth,
        this.id(itemIdRaw),
        this.parse(uploadSchema, body, "INVALID_SEED_UPLOAD"),
      )
      .catch((error: unknown) => {
        if (error instanceof MediaUploadError)
          throw new HttpException(
            { error: { code: error.code, message: error.message } },
            error.statusCode,
          );
        throw error;
      });
  }

  @Post("items/:itemId/confirm-upload")
  @RequireAdminStepUp()
  confirmUpload(@Param("itemId") itemIdRaw: string) {
    return this.seeding.confirmUpload(this.id(itemIdRaw));
  }

  @Post("items/:itemId/publish")
  @RequireAdminStepUp()
  publish(@Req() request: AdminAuthenticatedRequest, @Param("itemId") itemIdRaw: string) {
    return this.seeding.publish(request.ayinAuth.accountId, this.id(itemIdRaw));
  }

  @Post("batches/:batchId/rollback")
  @RequireAdminStepUp()
  rollback(@Req() request: AdminAuthenticatedRequest, @Param("batchId") batchIdRaw: string) {
    return this.seeding.rollback(request.ayinAuth.accountId, this.id(batchIdRaw));
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
      throw adminBadRequest(code, parsed.error.issues[0]?.message ?? "The request is invalid.");
    }
    return parsed.data;
  }
}
