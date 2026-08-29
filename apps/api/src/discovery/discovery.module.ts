import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { DiscoveryController, PublicDiscoveryController } from "./discovery.controller.js";
import { DiscoveryService, HomeRowConfigService } from "./discovery.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PublicDiscoveryController, DiscoveryController],
  providers: [HomeRowConfigService, DiscoveryService],
  exports: [HomeRowConfigService, DiscoveryService],
})
export class DiscoveryModule {}
