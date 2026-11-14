import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import {
  AdminGuard,
  RequireAdminRoles,
  RequireAdminStepUp,
  type AdminAuthenticatedRequest,
} from "../admin/admin.guard.js";
import { MobileConfigService } from "./mobile-config.service.js";
import { MobileDevicesService } from "./mobile-devices.service.js";
import { MobilePushService } from "./mobile-push.service.js";
import {
  mobileDeviceSchema,
  mobilePushInputSchema,
  mobileRuntimeConfigSchema,
} from "./mobile.schemas.js";

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.safeParse(raw);
  if (!value.success)
    throw new BadRequestException({
      error: {
        code: "INVALID_MOBILE_INPUT",
        message: value.error.issues[0]?.message ?? "Invalid mobile request.",
      },
    });
  return value.data;
}
@Controller("mobile")
export class MobileController {
  constructor(
    @Inject(MobileConfigService) private readonly config: MobileConfigService,
    @Inject(MobileDevicesService) private readonly devices: MobileDevicesService,
    @Inject(MobilePushService) private readonly push: MobilePushService,
  ) {}
  @Get("config")
  @Header("Cache-Control", "no-store")
  configRead() {
    return this.config.get();
  }
  @Post("devices")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  register(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.devices.register(request.ayinAuth, parse(mobileDeviceSchema, body));
  }
  @Get("devices/:installationId")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  device(@Req() request: AuthenticatedRequest, @Param("installationId") installationId: string) {
    return this.devices.get(
      request.ayinAuth.accountId,
      request.ayinAuth.sessionId,
      parse(z.string().uuid(), installationId),
    );
  }
  @Delete("devices/:installationId")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  remove(@Req() request: AuthenticatedRequest, @Param("installationId") installationId: string) {
    return this.devices.remove(request.ayinAuth, parse(z.string().uuid(), installationId));
  }
  @Get("notifications/:notificationId/destination")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  destination(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId") notificationId: string,
  ) {
    return this.push.destination(
      request.ayinAuth.accountId,
      parse(z.string().uuid(), notificationId),
    );
  }
}
@Controller("admin/mobile")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("SUPERADMIN")
export class AdminMobileController {
  constructor(
    @Inject(MobileConfigService) private readonly config: MobileConfigService,
    @Inject(MobilePushService) private readonly push: MobilePushService,
  ) {}
  @Get("config")
  @Header("Cache-Control", "private, no-store")
  configRead() {
    return this.config.get();
  }
  @Put("config")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  configWrite(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const input = parse(
      z
        .object({ config: mobileRuntimeConfigSchema, reason: z.string().trim().min(4).max(500) })
        .strict(),
      body,
    );
    return this.config.update(request.ayinAuth, input.config, input.reason);
  }
  @Get("status")
  @Header("Cache-Control", "private, no-store")
  status() {
    return this.push.status();
  }
  @Get("deliveries")
  @Header("Cache-Control", "private, no-store")
  deliveries(@Query() query: unknown) {
    return this.push.deliveries(
      parse(z.object({ accountId: z.string().uuid() }).strict(), query).accountId,
    );
  }
  @Post("push")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  pushTest(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.push.sendTargeted(request.ayinAuth, parse(mobilePushInputSchema, body));
  }
}
