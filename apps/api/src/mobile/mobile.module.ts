import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MobileConfigService } from "./mobile-config.service.js";
import { MobileDevicesService } from "./mobile-devices.service.js";
import { FcmHttpV1Service } from "./fcm-http-v1.service.js";
import { MobilePushService } from "./mobile-push.service.js";
import { AdminMobileController, MobileController } from "./mobile.controller.js";
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [MobileController, AdminMobileController],
  providers: [MobileConfigService, MobileDevicesService, FcmHttpV1Service, MobilePushService],
})
export class MobileModule {}
