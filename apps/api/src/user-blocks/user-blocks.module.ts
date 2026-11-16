import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { UserBlocksController } from "./user-blocks.controller.js";
import { UserBlocksService } from "./user-blocks.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [UserBlocksController],
  providers: [UserBlocksService],
  exports: [UserBlocksService],
})
export class UserBlocksModule {}
