import { Module } from "@nestjs/common";

import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { AuthConfig } from "./auth.config.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";
import { AuthService } from "./auth.service.js";
import { AuthTokenService } from "./auth-token.service.js";
import { CreatorProvisioningService } from "./creator-provisioning.service.js";
import { EMAIL_ADAPTER, UnconfiguredEmailAdapter } from "./email.adapter.js";
import { PasswordService } from "./password.service.js";

@Module({
  imports: [PlatformConfigModule],
  controllers: [AuthController],
  providers: [
    AuthConfig,
    AuthGuard,
    AuthRateLimiter,
    AuthService,
    AuthTokenService,
    CreatorProvisioningService,
    PasswordService,
    UnconfiguredEmailAdapter,
    { provide: EMAIL_ADAPTER, useExisting: UnconfiguredEmailAdapter },
  ],
  exports: [AuthGuard, AuthService, CreatorProvisioningService],
})
export class AuthModule {}
