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
import { CommentRateLimiter } from "./comment-rate-limiter.js";
import { CommentsError } from "./comments.errors.js";
import { CommentsService } from "./comments.service.js";

const uuid = z.string().uuid();
const page = z
  .object({
    cursor: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
const write = z
  .object({ body: z.string(), parentId: uuid.optional(), profileId: uuid.optional() })
  .strict();
const edit = z.object({ body: z.string() }).strict();
const profile = z.object({ profileId: uuid.optional() }).strict();
const report = z
  .object({
    reason: z.enum([
      "SPAM",
      "HARASSMENT",
      "HATE",
      "SEXUAL_CONTENT",
      "VIOLENCE",
      "MISLEADING",
      "OTHER",
    ]),
    details: z.string().max(2_000).optional(),
    profileId: uuid.optional(),
  })
  .strict();
const toggle = z.object({ enabled: z.boolean() }).strict();
const moderate = z
  .object({
    status: z.enum(["PUBLISHED", "HIDDEN", "REMOVED"]),
    reason: z.string().max(1_000).optional(),
  })
  .strict();

@Controller("comments")
export class CommentsController {
  constructor(
    @Inject(CommentsService) private readonly comments: CommentsService,
    @Inject(CommentRateLimiter) private readonly rateLimiter: CommentRateLimiter,
  ) {}

  @Get("videos/:videoId")
  list(@Param("videoId") rawId: string, @Query() rawQuery: unknown) {
    const videoId = parseUuid(rawId);
    const query = parse(page, rawQuery);
    return run(() => this.comments.list(videoId, query.cursor, query.limit));
  }

  @Post("videos/:videoId")
  @UseGuards(AuthGuard)
  create(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    this.rateLimiter.consume(`create:${request.ayinAuth.accountId}`, 20);
    const body = parse(write, rawBody);
    return run(() =>
      this.comments.create(
        request.ayinAuth.accountId,
        parseUuid(rawId),
        body.body,
        body.parentId,
        body.profileId,
      ),
    );
  }

  @Patch(":commentId")
  @UseGuards(AuthGuard)
  edit(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    this.rateLimiter.consume(`edit:${request.ayinAuth.accountId}`, 30);
    const body = parse(edit, rawBody);
    return run(() => this.comments.edit(request.ayinAuth.accountId, parseUuid(rawId), body.body));
  }

  @Delete(":commentId")
  @UseGuards(AuthGuard)
  remove(@Req() request: AuthenticatedRequest, @Param("commentId") rawId: string) {
    this.rateLimiter.consume(`remove:${request.ayinAuth.accountId}`, 30);
    return run(() => this.comments.remove(request.ayinAuth.accountId, parseUuid(rawId)));
  }

  @Put(":commentId/like")
  @UseGuards(AuthGuard)
  like(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parse(profile, rawBody);
    return run(() =>
      this.comments.setLike(request.ayinAuth.accountId, parseUuid(rawId), true, body.profileId),
    );
  }

  @Delete(":commentId/like")
  @UseGuards(AuthGuard)
  unlike(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Query() rawQuery: unknown,
  ) {
    const query = parse(profile, rawQuery);
    return run(() =>
      this.comments.setLike(request.ayinAuth.accountId, parseUuid(rawId), false, query.profileId),
    );
  }

  @Put(":commentId/:mark")
  @UseGuards(AuthGuard)
  mark(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Param("mark") rawMark: string,
  ) {
    const mark = parseMark(rawMark);
    return run(() =>
      this.comments.creatorMark(request.ayinAuth.accountId, parseUuid(rawId), mark, true),
    );
  }

  @Delete(":commentId/:mark")
  @UseGuards(AuthGuard)
  unmark(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Param("mark") rawMark: string,
  ) {
    const mark = parseMark(rawMark);
    return run(() =>
      this.comments.creatorMark(request.ayinAuth.accountId, parseUuid(rawId), mark, false),
    );
  }

  @Post(":commentId/report")
  @UseGuards(AuthGuard)
  report(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    this.rateLimiter.consume(`report:${request.ayinAuth.accountId}`, 10);
    const body = parse(report, rawBody);
    return run(() =>
      this.comments.report(
        request.ayinAuth.accountId,
        parseUuid(rawId),
        body.reason,
        body.details,
        body.profileId,
      ),
    );
  }

  @Patch("videos/:videoId/settings")
  @UseGuards(AuthGuard)
  videoSettings(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parse(toggle, rawBody);
    return run(() =>
      this.comments.setVideoComments(request.ayinAuth.accountId, parseUuid(rawId), body.enabled),
    );
  }

  @Put("channels/:channelId/hidden-profiles/:profileId")
  @UseGuards(AuthGuard)
  hide(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channel: string,
    @Param("profileId") profileId: string,
  ) {
    return run(() =>
      this.comments.hideProfile(
        request.ayinAuth.accountId,
        parseUuid(channel),
        parseUuid(profileId),
        true,
      ),
    );
  }

  @Delete("channels/:channelId/hidden-profiles/:profileId")
  @UseGuards(AuthGuard)
  unhide(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channel: string,
    @Param("profileId") profileId: string,
  ) {
    return run(() =>
      this.comments.hideProfile(
        request.ayinAuth.accountId,
        parseUuid(channel),
        parseUuid(profileId),
        false,
      ),
    );
  }

  @Patch(":commentId/moderation")
  @UseGuards(AuthGuard)
  moderate(
    @Req() request: AuthenticatedRequest,
    @Param("commentId") rawId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parse(moderate, rawBody);
    return run(() =>
      this.comments.moderate(
        request.ayinAuth.accountId,
        parseUuid(rawId),
        body.status,
        body.reason,
      ),
    );
  }
}

function parseUuid(value: string) {
  const result = uuid.safeParse(value);
  if (!result.success) throw http(new CommentsError("INVALID_ID", "Invalid identifier."));
  return result.data;
}
function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw http(
      new CommentsError("INVALID_INPUT", result.error.issues[0]?.message ?? "Invalid input."),
    );
  return result.data;
}
function parseMark(value: string): "heart" | "pin" {
  if (value !== "heart" && value !== "pin")
    throw http(new CommentsError("INVALID_MARK", "Unknown comment mark."));
  return value;
}
async function run<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw http(error);
  }
}
function http(error: unknown): Error {
  if (error instanceof CommentsError)
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  return error instanceof Error ? error : new Error("Unexpected comment error.");
}
