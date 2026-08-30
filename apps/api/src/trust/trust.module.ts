import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AdminTrustController, TrustController } from "./trust.controller.js";
import { TrustService } from "./trust.service.js";
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [TrustController, AdminTrustController],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
