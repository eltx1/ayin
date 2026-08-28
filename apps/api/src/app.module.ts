import { Module } from "@nestjs/common";

import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
