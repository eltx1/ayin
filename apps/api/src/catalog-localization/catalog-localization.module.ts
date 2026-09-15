import { Global, Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import {
  AdminCatalogLocalizationController,
  PublicMovieSitemapController,
} from "./catalog-localization.controller.js";
import { CatalogLocalizationService } from "./catalog-localization.service.js";

@Global()
@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [AdminCatalogLocalizationController, PublicMovieSitemapController],
  providers: [CatalogLocalizationService],
  exports: [CatalogLocalizationService],
})
export class CatalogLocalizationModule {}
