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
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { AdminGuard } from "../admin/admin.guard.js";
import {
  communityCommentSchema,
  communityPostInputSchema,
  communityReportSchema,
} from "./community.schemas.js";
import { CommunityError, CommunityService } from "./community.service.js";
const uuid = z.string().uuid();
const imageSchema = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();
function id(raw: string) {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success)
    throw error(new CommunityError("INVALID_ID", "This community link is invalid."));
  return parsed.data;
}
function error(value: unknown): Error {
  return value instanceof CommunityError
    ? new HttpException({ error: { code: value.code, message: value.message } }, value.statusCode)
    : value instanceof Error
      ? value
      : new Error("Unexpected community error.");
}
async function run<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (value) {
    throw error(value);
  }
}

@Controller("creator/community")
@UseGuards(AuthGuard)
export class CreatorCommunityController {
  constructor(@Inject(CommunityService) private readonly service: CommunityService) {}
  @Get("posts") list(@Req() request: AuthenticatedRequest) {
    return run(() => this.service.creatorPosts(request.ayinAuth.accountId));
  }
  @Post("posts") create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return run(() =>
      this.service.create(request.ayinAuth.accountId, communityPostInputSchema.parse(body)),
    );
  }
  @Patch("posts/:postId") update(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    return run(() =>
      this.service.update(
        request.ayinAuth.accountId,
        id(raw),
        communityPostInputSchema.parse(body),
      ),
    );
  }
  @Post("posts/:postId/publish") publish(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
  ) {
    return run(() => this.service.publish(request.ayinAuth.accountId, id(raw)));
  }
  @Delete("posts/:postId") remove(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
  ) {
    return run(() => this.service.remove(request.ayinAuth.accountId, id(raw)));
  }
  @Post("posts/:postId/image/authorize") image(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    return run(() =>
      this.service.authorizeImage(request.ayinAuth.accountId, id(raw), imageSchema.parse(body)),
    );
  }
  @Post("posts/:postId/image/complete") complete(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    const parsed = z.object({ assetId: uuid }).parse(body);
    return run(() =>
      this.service.completeImage(request.ayinAuth.accountId, id(raw), parsed.assetId),
    );
  }
}

@Controller("public/community")
export class PublicCommunityController {
  constructor(@Inject(CommunityService) private readonly service: CommunityService) {}
  @Get("channels/:handle") channel(@Param("handle") handle: string, @Query("take") take?: string) {
    return run(() => this.service.channelPosts(handle, take ? Number(take) : 30));
  }
}

@Controller("community")
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly service: CommunityService) {}
  @Get("feed") feed(@Req() request: AuthenticatedRequest, @Query("take") take?: string) {
    return run(() =>
      this.service.subscriberFeed(request.ayinAuth.accountId, take ? Number(take) : 50),
    );
  }
  @Put("posts/:postId/reaction") react(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
  ) {
    return run(() => this.service.react(request.ayinAuth.accountId, id(raw), true));
  }
  @Delete("posts/:postId/reaction") unreact(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
  ) {
    return run(() => this.service.react(request.ayinAuth.accountId, id(raw), false));
  }
  @Put("posts/:postId/poll/:optionId") vote(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Param("optionId") option: string,
  ) {
    return run(() => this.service.vote(request.ayinAuth.accountId, id(raw), id(option)));
  }
  @Post("posts/:postId/comments") comment(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    const parsed = communityCommentSchema.parse(body);
    return run(() =>
      this.service.comment(request.ayinAuth.accountId, id(raw), parsed.body, parsed.parentId),
    );
  }
  @Post("posts/:postId/reports") report(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    return run(() =>
      this.service.report(request.ayinAuth.accountId, id(raw), communityReportSchema.parse(body)),
    );
  }
}

@Controller("admin/community")
@UseGuards(AuthGuard, AdminGuard)
export class AdminCommunityController {
  constructor(@Inject(CommunityService) private readonly service: CommunityService) {}
  @Get("reports") queue() {
    return this.service.adminQueue();
  }
  @Patch("posts/:postId") moderate(
    @Req() request: AuthenticatedRequest,
    @Param("postId") raw: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({
        action: z.enum(["HIDE", "REMOVE", "RESTORE"]),
        reason: z.string().trim().min(3).max(1000),
      })
      .parse(body);
    return run(() =>
      this.service.adminModerate(request.ayinAuth.accountId, id(raw), parsed.action, parsed.reason),
    );
  }
}
