import { type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { usesCookieSession } from "../security/request-security.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

// Anonymous reads remain public. Any explicitly supplied session must pass the
// same current-authority and transport-isolation checks as a protected route.
@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  constructor(@Inject(AuthService) authService: AuthService) {
    super(authService);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers.authorization === undefined && !usesCookieSession(request)) return true;
    return super.canActivate(context);
  }
}
