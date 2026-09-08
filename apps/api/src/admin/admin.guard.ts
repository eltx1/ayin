import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthHttpError, unauthorized } from "../auth/auth.errors.js";
import { MfaService } from "../auth/mfa.service.js";
import { AdminAuthorizationService } from "./admin-authorization.service.js";
import { adminForbidden } from "./admin.errors.js";
import { isPrivilegedAdminRole, type AdminRole } from "./admin.roles.js";

const ADMIN_ROLES_METADATA = "ayin.admin.requiredRoles";
const ADMIN_STEP_UP_METADATA = "ayin.admin.stepUp";

export const RequireAdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_METADATA, roles);
export const RequireAdminStepUp = () => SetMetadata(ADMIN_STEP_UP_METADATA, true);

export interface AdminAuthenticatedRequest extends AuthenticatedRequest {
  ayinAdmin: { roles: AdminRole[] };
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthorizationService)
    private readonly authorization: AdminAuthorizationService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(MfaService) private readonly mfa: MfaService,
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

    // SUPERADMIN is a hard security boundary. A broad ADMIN role may bypass scoped
    // staff-role metadata for ordinary admin operations, but it must never satisfy
    // an endpoint that explicitly requires SUPERADMIN.
    if (requiredRoles?.includes("SUPERADMIN") && !roles.includes("SUPERADMIN")) {
      throw adminForbidden("This operation requires a superadministrator.");
    }

    const privileged = roles.some(isPrivilegedAdminRole);
    if (privileged) {
      await this.mfa.assertAdminMfa(
        request.ayinAuth.accountId,
        request.ayinAuth.mfaAt,
        request.ayinAuth.mfaVersion,
      );
    }
    if (!privileged) {
      if (!requiredRoles?.length) {
        throw adminForbidden("This staff role is not permitted on this admin operation.");
      }
      if (!requiredRoles.some((role) => roles.includes(role))) {
        throw adminForbidden("This administrator role cannot perform that operation.");
      }
    }

    const requiresStepUp = this.reflector.getAllAndOverride<boolean>(ADMIN_STEP_UP_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const fiveMinutesAgo = Math.floor(Date.now() / 1_000) - 300;
    if (
      requiresStepUp &&
      (!request.ayinAuth.reauthAt || request.ayinAuth.reauthAt < fiveMinutesAgo)
    ) {
      throw new AuthHttpError(
        403,
        "STEP_UP_REQUIRED",
        "Re-enter your password and authentication code before this sensitive operation.",
      );
    }

    (request as AdminAuthenticatedRequest).ayinAdmin = { roles };
    return true;
  }
}
