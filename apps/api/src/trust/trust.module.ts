import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { TrustController, AdminTrustController } from "./trust.controller.js";
import { TrustRateLimiter } from "./trust-rate-limiter.js";
import { TrustService } from "./trust.service.js";

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [TrustController, AdminTrustController],
  providers: [TrustService, TrustRateLimiter],
  exports: [TrustService],
})
export class TrustModule {}
