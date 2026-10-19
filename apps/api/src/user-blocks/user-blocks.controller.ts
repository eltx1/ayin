import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthRateLimiter } from "../auth/auth-rate-limiter.js";
import { UserBlocksService } from "./user-blocks.service.js";

export const blockTargetSchema = z.union([
  z.object({ channelId: z.uuid() }).strict(),
  z.object({ profileId: z.uuid() }).strict(),
]);

@Controller("user-blocks")
@UseGuards(AuthGuard)
export class UserBlocksController {
  constructor(
    @Inject(UserBlocksService) private readonly blocks: UserBlocksService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: AuthenticatedRequest) {
    return this.blocks.list(request.ayinAuth.accountId);
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  block(@Req() request: AuthenticatedRequest, @Body() input: unknown) {
    const parsed = blockTargetSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Choose exactly one channel or profile to block.");
    this.limiter.consume("user-block-write", request.ayinAuth.accountId);
    return this.blocks.block(request.ayinAuth, parsed.data);
  }

  @Delete(":blockedAccountId")
  @Header("Cache-Control", "private, no-store")
  unblock(@Req() request: AuthenticatedRequest, @Param("blockedAccountId") id: string) {
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw new BadRequestException("Invalid blocked user.");
    this.limiter.consume("user-block-write", request.ayinAuth.accountId);
    return this.blocks.unblock(request.ayinAuth, parsed.data);
  }
}
