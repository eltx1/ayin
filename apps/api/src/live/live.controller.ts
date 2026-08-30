import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { LiveError, LiveService } from "./live.service.js";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  scheduledStartAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const stateSchema = z.object({ status: z.enum(["LIVE", "ENDED", "CANCELLED"]) });
const chatSchema = z.object({ body: z.string().trim().min(1).max(500) });
const moderationSchema = z.object({
  action: z.enum(["HIDE_MESSAGE", "REMOVE_MESSAGE"]),
  reason: z.string().trim().max(1000).nullable().optional(),
});
const toggleChatSchema = z.object({ enabled: z.boolean() });

@Controller("live")
export class PublicLiveController {
  constructor(@Inject(LiveService) private readonly live: LiveService) {}

  @Get(":slug")
  async stream(@Param("slug") slug: string) {
    return call(() => this.live.publicStream(slug));
  }

  @Get(":slug/chat")
  async chat(@Param("slug") slug: string) {
    return call(() => this.live.chat(slug));
  }

  @Post(":slug/chat")
  @UseGuards(AuthGuard)
  async postChat(
    @Req() request: AuthenticatedRequest,
    @Param("slug") slug: string,
    @Body() body: unknown,
  ) {
    const input = chatSchema.parse(body);
    return call(() => this.live.postChat(request.ayinAuth.accountId, slug, input.body));
  }
}

@Controller("studio/live")
@UseGuards(AuthGuard)
export class StudioLiveController {
  constructor(@Inject(LiveService) private readonly live: LiveService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return call(() => this.live.studioStreams(request.ayinAuth.accountId));
  }

  @Post()
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return call(() => this.live.create(request.ayinAuth.accountId, createSchema.parse(body)));
  }

  @Post(":id/provision")
  async provision(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return call(() => this.live.provision(request.ayinAuth.accountId, id));
  }

  @Post(":id/rotate-key")
  async rotate(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return call(() => this.live.rotateKey(request.ayinAuth.accountId, id));
  }

  @Patch(":id/state")
  async state(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = stateSchema.parse(body);
    return call(() => this.live.setState(request.ayinAuth.accountId, id, input.status));
  }

  @Patch(":id/chat")
  async toggleChat(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return call(() =>
      this.live.setChatEnabled(
        request.ayinAuth.accountId,
        id,
        toggleChatSchema.parse(body).enabled,
      ),
    );
  }

  @Post(":id/chat/:messageId/moderate")
  async moderate(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @Body() body: unknown,
  ) {
    const input = moderationSchema.parse(body);
    return call(() =>
      this.live.moderateMessage(
        request.ayinAuth.accountId,
        id,
        messageId,
        input.action,
        input.reason,
      ),
    );
  }
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LiveError)
      throw new HttpException({ code: error.code, message: error.message }, error.statusCode);
    if (error instanceof z.ZodError)
      throw new HttpException({ code: "INVALID_LIVE_INPUT", issues: error.issues }, 400);
    throw error;
  }
}
