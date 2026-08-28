import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";

import { AuthConfig } from "./auth.config.js";
import { badRequest } from "./auth.errors.js";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";
import { AuthService } from "./auth.service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./schemas.js";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  readSessionToken,
  wantsBearerToken,
} from "./session-transport.js";

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest("VALIDATION_ERROR", result.error.issues[0]?.message ?? "Invalid request.");
  }
  return result.data;
}

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuthConfig) private readonly authConfig: AuthConfig,
    @Inject(AuthRateLimiter) private readonly rateLimiter: AuthRateLimiter,
  ) {}

  @Post("register")
  async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimiter.consume("register", request.ip);
    const result = await this.authService.register(parseBody(registerSchema, body));
    return this.finishSession(request, reply, result);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.rateLimiter.consume("login", request.ip);
    const result = await this.authService.login(parseBody(loginSchema, body));
    return this.finishSession(request, reply, result);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.logout(readSessionToken(request));
    reply.header("set-cookie", buildClearedSessionCookie(this.authConfig));
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async currentUser(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentIdentity(request.ayinAuth.accountId);
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.rateLimiter.consume("forgot-password", request.ip);
    await this.authService.requestPasswordReset(parseBody(forgotPasswordSchema, body));
    return { accepted: true };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.rateLimiter.consume("reset-password", request.ip);
    await this.authService.resetPassword(parseBody(resetPasswordSchema, body));
    return { reset: true };
  }

  private finishSession(
    request: FastifyRequest,
    reply: FastifyReply,
    result: Awaited<ReturnType<AuthService["login"]>>,
  ) {
    if (wantsBearerToken(request)) {
      return { sessionToken: result.token, user: result.user };
    }

    reply.header("set-cookie", buildSessionCookie(result.token, this.authConfig));
    return { user: result.user };
  }
}
