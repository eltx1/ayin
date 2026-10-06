import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import { directDecisionContextSchema } from "./direct-ad.schemas.js";
import { advertisingError } from "./advertising-write-contract.js";

const uuid = z.string().uuid();
const killSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(1000).optional(),
});
const directEventSchema = z.object({
  placementKey: z.string().trim().min(1).max(120),
  campaignId: z.string().uuid(),
  creativeId: z.string().uuid(),
  eventType: z.enum(["REQUEST", "FILL", "IMPRESSION", "CLICK", "ERROR"]),
  sessionId: z.string().trim().min(1).max(120),
  requestId: z.string().trim().min(1).max(120).optional(),
});

@Controller("ads/direct")
export class DirectAdController {
  constructor(
    @Inject(AdvertisingControlService) private readonly advertising: AdvertisingControlService,
  ) {}

  @Get("decision")
  async decide(@Query() query: Record<string, unknown>) {
    const parsed = directDecisionContextSchema.safeParse({
      placementKey: query.placementKey,
      sessionId: query.sessionId,
      device: query.device,
      country: query.country ?? null,
      region: query.region ?? null,
      category: query.category ?? null,
      channelId: query.channelId ?? null,
      videoId: query.videoId ?? null,
    });
    if (!parsed.success) throw this.invalid("INVALID_DIRECT_AD_CONTEXT");
    const placements = await this.advertising.listPlacements();
    const placement = placements.find((item) => item.key === parsed.data.placementKey);
    if (!placement?.enabled) {
      return { enabled: false as const, reason: "PLACEMENT_DISABLED" };
    }
    return this.advertising.decideDirectAd(parsed.data);
  }

  @Post("events")
  async event(@Body() body: unknown) {
    const parsed = directEventSchema.safeParse(body);
    if (!parsed.success) throw this.invalid("INVALID_DIRECT_AD_EVENT");
    return this.advertising.recordDirectEvent({
      placementKey: parsed.data.placementKey,
      campaignId: parsed.data.campaignId,
      creativeId: parsed.data.creativeId,
      eventType: parsed.data.eventType,
      sessionId: parsed.data.sessionId,
      ...(parsed.data.requestId !== undefined ? { requestId: parsed.data.requestId } : {}),
    });
  }

  private invalid(code: string) {
    return new HttpException(
      { error: { code, message: "Invalid direct advertising request." } },
      400,
    );
  }
}

@Controller("admin/advertising")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("AD_MANAGER")
export class AdminAdvertisingControlController {
  constructor(
    @Inject(AdvertisingControlService) private readonly advertising: AdvertisingControlService,
  ) {}

  @Get("overview")
  async overview() {
    const [emergencyKillSwitch, placements, eventCounters] = await Promise.all([
      this.advertising.isEmergencyKilled(),
      this.advertising.listPlacements(),
      this.advertising.getEventCounters(),
    ]);
    return { emergencyKillSwitch, placements, eventCounters };
  }

  @Patch("kill-switch")
  @RequireAdminStepUp()
  async killSwitch(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = killSwitchSchema.safeParse(body);
    if (!parsed.success) throw this.invalid("INVALID_KILL_SWITCH");
    return this.advertising.setEmergencyKillSwitch(
      request.ayinAuth.accountId,
      parsed.data.enabled,
      parsed.data.reason,
    );
  }

  @Get("placements")
  placements() {
    return this.advertising.listPlacements();
  }

  @Post("placements")
  @RequireAdminStepUp()
  async createPlacement(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createPlacement(request.ayinAuth.accountId, body));
  }

  @Patch("placements/:id")
  @RequireAdminStepUp()
  async updatePlacement(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.advertising.updatePlacement(request.ayinAuth.accountId, this.id(idRaw), body),
    );
  }

  @Get("workspace")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  workspace() {
    return this.advertising.workspace();
  }

  @Get("mutations/:mutationId")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  mutationRecord(
    @Req() request: AdminAuthenticatedRequest,
    @Param("mutationId") mutationId: string,
  ) {
    return this.advertising.mutationRecord(request.ayinAuth.accountId, this.id(mutationId));
  }

  @Get("advertisers")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  advertisers() {
    return this.advertising.listAdvertisers();
  }

  @Get("advertisers/:id")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  advertiser(@Param("id") id: string) {
    return this.advertising.advertiserRecord(this.id(id));
  }

  @Post("advertisers")
  @RequireAdminStepUp()
  createAdvertiser(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.executeWorkspace(() => this.advertising.createAdvertiser(request.ayinAuth, body));
  }

  @Patch("advertisers/:id")
  @RequireAdminStepUp()
  updateAdvertiser(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.executeWorkspace(() =>
      this.advertising.updateAdvertiser(request.ayinAuth, this.id(idRaw), body),
    );
  }

  @Delete("advertisers/:id")
  @RequireAdminStepUp()
  deleteAdvertiser(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.executeWorkspace(() =>
      this.advertising.deleteAdvertiser(request.ayinAuth, this.id(idRaw), body ?? {}),
    );
  }

  @Get("campaigns")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  campaigns() {
    return this.advertising.listCampaigns();
  }

  @Get("campaigns/:id")
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  campaign(@Param("id") id: string) {
    return this.advertising.campaignRecord(this.id(id));
  }

  @Post("campaigns")
  @RequireAdminStepUp()
  createCampaign(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.executeWorkspace(() => this.advertising.createCampaign(request.ayinAuth, body));
  }

  @Patch("campaigns/:id")
  @RequireAdminStepUp()
  updateCampaign(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.executeWorkspace(() =>
      this.advertising.updateCampaign(request.ayinAuth, this.id(idRaw), body),
    );
  }

  @Delete("campaigns/:id")
  @RequireAdminStepUp()
  deleteCampaign(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.executeWorkspace(() =>
      this.advertising.deleteCampaign(request.ayinAuth, this.id(idRaw), body ?? {}),
    );
  }

  @Get("creatives")
  creatives(@Query("campaignId") campaignId?: string) {
    return this.advertising.listCreatives(campaignId ? this.id(campaignId) : undefined);
  }

  @Post("creatives")
  @RequireAdminStepUp()
  createCreative(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createCreative(request.ayinAuth.accountId, body));
  }

  @Patch("creatives/:id")
  @RequireAdminStepUp()
  updateCreative(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.advertising.updateCreative(request.ayinAuth.accountId, this.id(idRaw), body),
    );
  }

  @Delete("creatives/:id")
  @RequireAdminStepUp()
  deleteCreative(@Req() request: AdminAuthenticatedRequest, @Param("id") idRaw: string) {
    return this.execute(() =>
      this.advertising.deleteCreative(request.ayinAuth.accountId, this.id(idRaw)),
    );
  }

  private async executeWorkspace<T>(callback: () => Promise<T>) {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof z.ZodError) throw this.invalid("INVALID_ADVERTISING_MUTATION");
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "P2025")
        throw advertisingError(
          404,
          "ADVERTISING_RECORD_NOT_FOUND",
          "The advertising record is unavailable.",
        );
      if (code === "P2002" || code === "P2003" || code === "P2034")
        throw advertisingError(
          409,
          "ADVERTISING_WRITE_CONFLICT",
          "The advertising records changed or have dependent records. Review them before a new operation.",
        );
      // Audit/database/transport failures are uncertain server outcomes, never
      // reclassified as bad input or silently replayed.
      throw error;
    }
  }

  private async execute<T>(callback: () => Promise<T>) {
    try {
      return await callback();
    } catch {
      throw this.invalid("INVALID_ADVERTISING_MUTATION");
    }
  }

  private id(value: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw this.invalid("INVALID_ID");
    return parsed.data;
  }

  private invalid(code: string) {
    return new HttpException({ error: { code, message: "Check advertising control input." } }, 400);
  }
}
