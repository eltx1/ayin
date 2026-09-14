import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { AdminMovieCatalogController } from "./admin-movie-catalog.controller.js";
import { PublicMovieCatalogController } from "./movie-catalog.controller.js";
import { MovieCatalogService } from "./movie-catalog.service.js";

@Module({
  imports: [AdminModule, VideoPolicyModule],
  controllers: [PublicMovieCatalogController, AdminMovieCatalogController],
  providers: [MovieCatalogService],
  exports: [MovieCatalogService],
})
export class MovieCatalogModule {}
