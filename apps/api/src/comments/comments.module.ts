import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { CommentRateLimiter } from "./comment-rate-limiter.js";
import { CommentsController } from "./comments.controller.js";
import { CommentsService } from "./comments.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentRateLimiter],
  exports: [CommentsService],
})
export class CommentsModule {}
