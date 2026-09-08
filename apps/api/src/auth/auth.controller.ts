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
import { MfaService } from "./mfa.service.js";
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
import { z } from "zod";

const challengeStartSchema = z.object({ challengeToken: z.string().min(32).max(2_048) }).strict();
const authenticatedEnrollmentSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const enrollmentVerifySchema = z
  .object({ enrollmentToken: z.string().min(32).max(2_048), code: z.string().regex(/^\d{6}$/) })
  .strict();
const mfaChallengeSchema = z
  .object({
    challengeToken: z.string().min(32).max(2_048),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().trim().min(16).max(32).optional(),
  })
  .strict()
  .refine((value) => Number(Boolean(value.code)) + Number(Boolean(value.recoveryCode)) === 1, {
    message: "Enter either an authenticator code or a recovery code.",
  });
const stepUpSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
const recoveryRegenerateSchema = z
  .object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) })
  .strict();

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
    @Inject(MfaService) private readonly mfa: MfaService,
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

  @Post("mfa/enrollment/start")
  async startEnrollment(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = parseBody(challengeStartSchema, body);
    const subject = this.mfa.challengeSubject(input.challengeToken, "enroll");
    this.rateLimiter.consumeMfa("mfa-enrollment", `${request.ip}:${subject}`);
    return this.mfa.beginEnrollmentFromChallenge(input.challengeToken);
  }

  @Post("mfa/enrollment/start-authenticated")
  @UseGuards(AuthGuard)
  async startAuthenticatedEnrollment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseBody(authenticatedEnrollmentSchema, body);
    this.rateLimiter.consumeMfa("mfa-enrollment", request.ayinAuth.accountId);
    return this.mfa.beginAuthenticatedEnrollment(request.ayinAuth.accountId, input.password);
  }

  @Post("mfa/enrollment/verify")
  @HttpCode(HttpStatus.OK)
  async verifyEnrollment(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parseBody(enrollmentVerifySchema, body);
    const subject = this.mfa.enrollmentSubject(input.enrollmentToken);
    this.rateLimiter.consumeMfa("mfa-enrollment-verify", `${request.ip}:${subject}`);
    return this.finishSession(
      request,
      reply,
      await this.authService.completeMfaEnrollment(input.enrollmentToken, input.code),
    );
  }

  @Post("mfa/challenge")
  @HttpCode(HttpStatus.OK)
  async challenge(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parseBody(mfaChallengeSchema, body);
    const subject = this.mfa.challengeSubject(input.challengeToken, "verify");
    this.rateLimiter.consumeMfa("mfa-challenge", `${request.ip}:${subject}`);
    return this.finishSession(
      request,
      reply,
      await this.authService.completeMfaChallenge(input.challengeToken, {
        ...(input.code ? { code: input.code } : {}),
        ...(input.recoveryCode ? { recoveryCode: input.recoveryCode } : {}),
      }),
    );
  }

  @Get("mfa/status")
  @UseGuards(AuthGuard)
  status(@Req() request: AuthenticatedRequest) {
    return this.mfa.status(request.ayinAuth.accountId);
  }

  @Post("mfa/step-up")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async stepUp(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parseBody(stepUpSchema, body);
    this.rateLimiter.consumeMfa("mfa-step-up", request.ayinAuth.accountId);
    const result = await this.mfa.stepUp(request.ayinAuth.accountId, input.password, input.code);
    return this.finishToken(request, reply, result.token, { steppedUp: true });
  }

  @Post("mfa/recovery-codes/regenerate")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseBody(recoveryRegenerateSchema, body);
    this.rateLimiter.consumeMfa("mfa-recovery-regenerate", request.ayinAuth.accountId);
    return this.mfa.regenerateRecoveryCodes(request.ayinAuth.accountId, input.password, input.code);
  }

  @Post("mfa/disable")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async disableMfa(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parseBody(recoveryRegenerateSchema, body);
    this.rateLimiter.consumeMfa("mfa-disable", request.ayinAuth.accountId);
    const result = await this.mfa.disable(request.ayinAuth.accountId, input.password, input.code);
    reply.header("set-cookie", buildClearedSessionCookie(this.authConfig));
    return result;
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
    if ("mfaRequired" in result) return result;
    if (wantsBearerToken(request)) {
      return {
        sessionToken: result.token,
        user: result.user,
        ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}),
      };
    }

    reply.header("set-cookie", buildSessionCookie(result.token, this.authConfig));
    return {
      user: result.user,
      ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}),
    };
  }

  private finishToken(
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
    response: Record<string, unknown>,
  ) {
    if (wantsBearerToken(request)) return { ...response, sessionToken: token };
    reply.header("set-cookie", buildSessionCookie(token, this.authConfig));
    return response;
  }
}
