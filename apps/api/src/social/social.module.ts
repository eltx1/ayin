import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SocialController } from "./social.controller.js";
import { SocialService } from "./social.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SocialController],
  providers: [SocialService],
})
export class SocialModule {}
