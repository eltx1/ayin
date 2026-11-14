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
import { MobileDiagnosticsService } from "./mobile-diagnostics.service.js";
import { mobileDiagnosticSchema } from "./mobile-diagnostics.schema.js";
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
    @Inject(MobileDiagnosticsService) private readonly diagnostics: MobileDiagnosticsService,
  ) {}
  @Get("config")
  @Header("Cache-Control", "no-store")
  configRead() {
    return this.config.get();
  }
  @Post("diagnostics")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  diagnosticWrite(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (request.headers["x-ayin-expected-account"] !== request.ayinAuth.accountId)
      throw new BadRequestException(
        "An explicit expected account is required for app diagnostics.",
      );
    return this.diagnostics.record(
      request.ayinAuth,
      parse(mobileDiagnosticSchema, body),
      parse(z.string().uuid(), request.headers["x-ayin-viewer-profile"]),
      parse(
        z.coerce.number().int().min(1).max(1_000_000_000),
        request.headers["x-ayin-diagnostics-consent-version"],
      ),
    );
  }
  @Get("diagnostics/consent/:installationId")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  diagnosticConsent(
    @Req() request: AuthenticatedRequest,
    @Param("installationId") installationId: string,
  ) {
    if (request.headers["x-ayin-expected-account"] !== request.ayinAuth.accountId)
      throw new BadRequestException(
        "An explicit expected account is required for app diagnostics.",
      );
    return this.diagnostics.consent(
      request.ayinAuth,
      parse(z.string().uuid(), installationId),
      parse(z.string().uuid(), request.headers["x-ayin-viewer-profile"]),
    );
  }
  @Put("diagnostics/consent")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  diagnosticGrant(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (request.headers["x-ayin-expected-account"] !== request.ayinAuth.accountId)
      throw new BadRequestException(
        "An explicit expected account is required for app diagnostics.",
      );
    const input = parse(
      z
        .object({
          installationId: z.string().uuid(),
          enabled: z.literal(true),
          expectedConsentVersion: z.number().int().min(0).max(1_000_000_000),
        })
        .strict(),
      body,
    );
    return this.diagnostics.grant(
      request.ayinAuth,
      input.installationId,
      parse(z.string().uuid(), request.headers["x-ayin-viewer-profile"]),
      input.expectedConsentVersion,
    );
  }
  @Delete("diagnostics/:installationId")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "private, no-store")
  diagnosticRemove(
    @Req() request: AuthenticatedRequest,
    @Param("installationId") installationId: string,
  ) {
    if (request.headers["x-ayin-expected-account"] !== request.ayinAuth.accountId)
      throw new BadRequestException(
        "An explicit expected account is required for app diagnostics.",
      );
    return this.diagnostics.remove(request.ayinAuth, parse(z.string().uuid(), installationId));
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
    @Inject(MobileDiagnosticsService) private readonly diagnostics: MobileDiagnosticsService,
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
  @Get("diagnostics")
  @Header("Cache-Control", "private, no-store")
  diagnosticRead(@Query() query: unknown) {
    return this.diagnostics.list(
      parse(z.object({ accountId: z.string().uuid() }).strict(), query).accountId,
    );
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
