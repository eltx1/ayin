import {
  Body,
  Controller,
  Delete,
  Get,
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

import { AdminGuard, type AdminAuthenticatedRequest } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import { directDecisionContextSchema } from "./direct-ad.schemas.js";

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
  async createPlacement(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createPlacement(request.ayinAuth.accountId, body));
  }

  @Patch("placements/:id")
  async updatePlacement(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.advertising.updatePlacement(request.ayinAuth.accountId, this.id(idRaw), body),
    );
  }

  @Get("advertisers")
  advertisers() {
    return this.advertising.listAdvertisers();
  }

  @Post("advertisers")
  createAdvertiser(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createAdvertiser(request.ayinAuth.accountId, body));
  }

  @Patch("advertisers/:id")
  updateAdvertiser(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.advertising.updateAdvertiser(request.ayinAuth.accountId, this.id(idRaw), body),
    );
  }

  @Delete("advertisers/:id")
  deleteAdvertiser(@Req() request: AdminAuthenticatedRequest, @Param("id") idRaw: string) {
    return this.execute(() =>
      this.advertising.deleteAdvertiser(request.ayinAuth.accountId, this.id(idRaw)),
    );
  }

  @Get("campaigns")
  campaigns() {
    return this.advertising.listCampaigns();
  }

  @Post("campaigns")
  createCampaign(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createCampaign(request.ayinAuth.accountId, body));
  }

  @Patch("campaigns/:id")
  updateCampaign(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") idRaw: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.advertising.updateCampaign(request.ayinAuth.accountId, this.id(idRaw), body),
    );
  }

  @Delete("campaigns/:id")
  deleteCampaign(@Req() request: AdminAuthenticatedRequest, @Param("id") idRaw: string) {
    return this.execute(() =>
      this.advertising.deleteCampaign(request.ayinAuth.accountId, this.id(idRaw)),
    );
  }

  @Get("creatives")
  creatives(@Query("campaignId") campaignId?: string) {
    return this.advertising.listCreatives(campaignId ? this.id(campaignId) : undefined);
  }

  @Post("creatives")
  createCreative(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.execute(() => this.advertising.createCreative(request.ayinAuth.accountId, body));
  }

  @Patch("creatives/:id")
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
  deleteCreative(@Req() request: AdminAuthenticatedRequest, @Param("id") idRaw: string) {
    return this.execute(() =>
      this.advertising.deleteCreative(request.ayinAuth.accountId, this.id(idRaw)),
    );
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
