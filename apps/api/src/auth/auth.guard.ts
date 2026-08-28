import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuthService } from "./auth.service.js";
import { unauthorized } from "./auth.errors.js";
import { readSessionToken } from "./session-transport.js";

export interface AuthenticatedRequest extends FastifyRequest {
  ayinAuth: {
    accountId: string;
    authVersion: number;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = readSessionToken(request);
    if (!token) {
      throw unauthorized();
    }

    const auth = await this.authService.authenticate(token);
    (request as AuthenticatedRequest).ayinAuth = auth;
    return true;
  }
}
