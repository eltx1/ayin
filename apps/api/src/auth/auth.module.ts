import { Module } from "@nestjs/common";

import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { AuthConfig } from "./auth.config.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";
import { AuthService } from "./auth.service.js";
import { AuthTokenService } from "./auth-token.service.js";
import { CreatorProvisioningService } from "./creator-provisioning.service.js";
import { EMAIL_ADAPTER, SmtpEmailAdapter } from "./email.adapter.js";
import { PasswordService } from "./password.service.js";
import { MfaCryptoService } from "./mfa-crypto.service.js";
import { MfaService } from "./mfa.service.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [PlatformConfigModule],
  controllers: [AuthController],
  providers: [
    AuthConfig,
    AuthGuard,
    AuthRateLimiter,
    AuthService,
    AuthTokenService,
    MfaCryptoService,
    MfaService,
    SessionService,
    CreatorProvisioningService,
    PasswordService,
    SmtpEmailAdapter,
    { provide: EMAIL_ADAPTER, useExisting: SmtpEmailAdapter },
  ],
  exports: [
    AuthGuard,
    AuthRateLimiter,
    AuthService,
    CreatorProvisioningService,
    MfaService,
    PasswordService,
    SessionService,
  ],
})
export class AuthModule {}
