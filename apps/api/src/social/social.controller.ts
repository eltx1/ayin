import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { SocialError, SocialService } from "./social.service.js";

const uuid = z.string().uuid();
const profileQuery = z.object({ profileId: uuid.optional() }).strict();
const reactionBody = z
  .object({ type: z.enum(["LIKE", "DISLIKE"]), profileId: uuid.optional() })
  .strict();
const notificationQuery = z
  .object({
    cursor: z.coerce.number().int().min(0).max(10_000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

@Controller("social")
@UseGuards(AuthGuard)
export class SocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  @Get("channels/:channelId")
  channelState(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") raw: string,
    @Query() query: unknown,
  ) {
    const [channelId, parsed] = parse(raw, query);
    return run(() =>
      this.social.channelState(request.ayinAuth.accountId, channelId, parsed.profileId),
    );
  }
  @Put("channels/:channelId/subscription")
  subscribe(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") raw: string,
    @Body() body: unknown,
  ) {
    const [channelId, parsed] = parse(raw, body);
    return run(() =>
      this.social.subscribe(request.ayinAuth.accountId, channelId, parsed.profileId),
    );
  }
  @Delete("channels/:channelId/subscription")
  unsubscribe(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") raw: string,
    @Query() query: unknown,
  ) {
    const [channelId, parsed] = parse(raw, query);
    return run(() =>
      this.social.unsubscribe(request.ayinAuth.accountId, channelId, parsed.profileId),
    );
  }
  @Get("videos/:videoId")
  videoState(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") raw: string,
    @Query() query: unknown,
  ) {
    const [videoId, parsed] = parse(raw, query);
    return run(() => this.social.videoState(request.ayinAuth.accountId, videoId, parsed.profileId));
  }
  @Put("videos/:videoId/reaction")
  reaction(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") raw: string,
    @Body() body: unknown,
  ) {
    const videoId = parseUuid(raw);
    const parsed = reactionBody.safeParse(body);
    if (!parsed.success)
      throw http(new SocialError("INVALID_REACTION", "The reaction is invalid."));
    return run(() =>
      this.social.setReaction(
        request.ayinAuth.accountId,
        videoId,
        parsed.data.type,
        parsed.data.profileId,
      ),
    );
  }
  @Delete("videos/:videoId/reaction")
  clearReaction(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") raw: string,
    @Query() query: unknown,
  ) {
    const [videoId, parsed] = parse(raw, query);
    return run(() =>
      this.social.clearReaction(request.ayinAuth.accountId, videoId, parsed.profileId),
    );
  }
  @Put("videos/:videoId/:list")
  save(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") raw: string,
    @Param("list") listRaw: string,
    @Body() body: unknown,
  ) {
    const [videoId, parsed] = parse(raw, body);
    const list = parseList(listRaw);
    return run(() =>
      this.social.setSaved(request.ayinAuth.accountId, videoId, list, true, parsed.profileId),
    );
  }
  @Delete("videos/:videoId/:list")
  unsave(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") raw: string,
    @Param("list") listRaw: string,
    @Query() query: unknown,
  ) {
    const [videoId, parsed] = parse(raw, query);
    const list = parseList(listRaw);
    return run(() =>
      this.social.setSaved(request.ayinAuth.accountId, videoId, list, false, parsed.profileId),
    );
  }
  @Get("notifications")
  listNotifications(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = notificationQuery.safeParse(query);
    if (!parsed.success)
      throw http(new SocialError("INVALID_PAGINATION", "Notification pagination is invalid."));
    return run(() =>
      this.social.notifications(request.ayinAuth.accountId, parsed.data.cursor, parsed.data.limit),
    );
  }
  @Patch("notifications/:notificationId/read")
  read(@Req() request: AuthenticatedRequest, @Param("notificationId") raw: string) {
    return run(() => this.social.markNotificationRead(request.ayinAuth.accountId, parseUuid(raw)));
  }
}

function parse(raw: string, input: unknown): [string, z.infer<typeof profileQuery>] {
  const id = parseUuid(raw);
  const parsed = profileQuery.safeParse(input);
  if (!parsed.success)
    throw http(new SocialError("INVALID_PROFILE", "The viewer profile is invalid."));
  return [id, parsed.data];
}
function parseUuid(raw: string) {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw http(new SocialError("INVALID_ID", "This link is invalid."));
  return parsed.data;
}
function parseList(raw: string): "watch-later" | "my-list" {
  if (raw !== "watch-later" && raw !== "my-list")
    throw http(new SocialError("INVALID_LIST", "This saved list is invalid."));
  return raw;
}
async function run<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw http(error);
  }
}
function http(error: unknown): Error {
  if (error instanceof SocialError)
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  return error instanceof Error ? error : new Error("Unexpected social error.");
}
