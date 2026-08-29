import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { CreatorTvError, CreatorTvService } from "./creator-tv.service.js";

const uuidSchema = z.string().uuid();
const preferenceSchema = z
  .object({
    included: z.boolean(),
    priority: z.number().int().min(-100_000).max(100_000),
    sortOrder: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .strict();

@Controller("public/channels")
export class PublicCreatorTvController {
  constructor(@Inject(CreatorTvService) private readonly creatorTv: CreatorTvService) {}

  @Get(":handle/tv")
  async getTv(@Param("handle") handle: string) {
    return runTvOperation(() => this.creatorTv.getPublicTv(handle));
  }
}

@Controller("creator")
@UseGuards(AuthGuard)
export class CreatorTvController {
  constructor(@Inject(CreatorTvService) private readonly creatorTv: CreatorTvService) {}

  @Get("channels/:channelId/tv")
  async getManagement(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
  ) {
    const channelId = parseUuid(channelIdRaw, "This channel link is invalid.");
    return runTvOperation(() => this.creatorTv.getManagement(ownerActor(request), channelId));
  }

  @Put("tv/:tvChannelId/videos/:videoId")
  async setVideoPreference(
    @Req() request: AuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const tvChannelId = parseUuid(tvChannelIdRaw, "This Creator TV link is invalid.");
    const videoId = parseUuid(videoIdRaw, "This video link is invalid.");
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success) {
      throw tvHttpError(
        new CreatorTvError(
          "INVALID_TV_PREFERENCE",
          "Check the Creator TV include, priority and order values.",
        ),
      );
    }
    return runTvOperation(() =>
      this.creatorTv.setVideoPreference(ownerActor(request), tvChannelId, videoId, parsed.data),
    );
  }
}

function ownerActor(request: AuthenticatedRequest) {
  return { kind: "owner" as const, accountId: request.ayinAuth.accountId };
}

function parseUuid(raw: string, message: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw tvHttpError(new CreatorTvError("INVALID_ID", message));
  }
  return parsed.data;
}

async function runTvOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw tvHttpError(error);
  }
}

function tvHttpError(error: unknown): Error {
  if (error instanceof CreatorTvError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected Creator TV error.");
}
