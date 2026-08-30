import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { CreatorTvLinearService } from "./creator-tv-linear.service.js";
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
  constructor(
    @Inject(CreatorTvService) private readonly creatorTv: CreatorTvService,
    @Inject(CreatorTvLinearService) private readonly linear: CreatorTvLinearService,
  ) {}

  @Get(":handle/tv")
  async getTv(@Param("handle") handle: string) {
    return runTvOperation(() => this.creatorTv.getPublicTv(handle));
  }

  @Get(":handle/tv/linear")
  async getLinear(@Param("handle") handle: string) {
    return runTvOperation(() => this.linear.publicCapability(handle));
  }
}

@Controller("creator")
@UseGuards(AuthGuard)
export class CreatorTvController {
  constructor(
    @Inject(CreatorTvService) private readonly creatorTv: CreatorTvService,
    @Inject(CreatorTvLinearService) private readonly linear: CreatorTvLinearService,
  ) {}

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

  @Get("tv/:tvChannelId/linear")
  async linearStatus(
    @Req() request: AuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
  ) {
    const tvChannelId = parseUuid(tvChannelIdRaw, "This Creator TV link is invalid.");
    return runTvOperation(() => this.linear.status(ownerActor(request), tvChannelId));
  }

  @Post("tv/:tvChannelId/linear/provision")
  async provisionLinear(
    @Req() request: AuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
  ) {
    const tvChannelId = parseUuid(tvChannelIdRaw, "This Creator TV link is invalid.");
    return runTvOperation(() => this.linear.provision(ownerActor(request), tvChannelId));
  }

  @Post("tv/:tvChannelId/linear/reconcile")
  async reconcileLinear(
    @Req() request: AuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
  ) {
    const tvChannelId = parseUuid(tvChannelIdRaw, "This Creator TV link is invalid.");
    return runTvOperation(() => this.linear.reconcile(ownerActor(request), tvChannelId));
  }

  @Post("tv/:tvChannelId/linear/stop")
  async stopLinear(
    @Req() request: AuthenticatedRequest,
    @Param("tvChannelId") tvChannelIdRaw: string,
  ) {
    const tvChannelId = parseUuid(tvChannelIdRaw, "This Creator TV link is invalid.");
    return runTvOperation(() => this.linear.stop(ownerActor(request), tvChannelId));
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
