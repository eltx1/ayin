import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { unauthorized } from "../auth/auth.errors.js";
import { AdminAuthorizationService } from "./admin-authorization.service.js";
import { adminForbidden } from "./admin.errors.js";
import type { AdminRole } from "./admin.roles.js";

const ADMIN_ROLES_METADATA = "ayin.admin.requiredRoles";

export const RequireAdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_METADATA, roles);

export interface AdminAuthenticatedRequest extends AuthenticatedRequest {
  ayinAdmin: { roles: AdminRole[] };
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthorizationService)
    private readonly authorization: AdminAuthorizationService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.ayinAuth?.accountId) {
      throw unauthorized();
    }

    const roles = await this.authorization.getRoles(request.ayinAuth.accountId);
    if (roles.length === 0) {
      throw adminForbidden();
    }

    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length && !requiredRoles.some((role) => roles.includes(role))) {
      throw adminForbidden("This administrator role cannot perform that operation.");
    }

    (request as AdminAuthenticatedRequest).ayinAdmin = { roles };
    return true;
  }
}
