import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { SearchController } from "./search.controller.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [SearchRateLimiter, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
