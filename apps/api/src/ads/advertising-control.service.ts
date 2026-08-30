import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { chooseDirectCampaign, type DirectCampaignCandidate } from "./direct-ad-decision.js";
import {
  type DirectCampaignConfigInput,
  type DirectDecisionContext,
  advertiserCreateSchema,
  advertiserPatchSchema,
  campaignCreateSchema,
  campaignPatchSchema,
  creativeCreateSchema,
  creativePatchSchema,
  directCampaignConfigSchema,
  placementMutationSchema,
  placementPatchSchema,
} from "./direct-ad.schemas.js";

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class AdvertisingControlService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async isEmergencyKilled() {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
      select: { value: true },
    });
    return row?.value === true;
  }

  async setEmergencyKillSwitch(actorAccountId: string, enabled: boolean, reason?: string) {
    return this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
        update: { value: enabled, valueType: "BOOLEAN", schemaVersion: 1 },
        create: {
          namespace: "ADVERTISING",
          key: "emergencyKillSwitch",
          valueType: "BOOLEAN",
          value: enabled,
          schemaVersion: 1,
          description: "Emergency master advertising kill switch.",
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "AD_EMERGENCY_KILL_SWITCH_UPDATED",
        entityType: "PlatformSetting",
        entityId: "ADVERTISING/emergencyKillSwitch",
        ...(reason ? { reason } : {}),
        metadata: { enabled },
      });
      return { enabled };
    });
  }

  async listPlacements() {
    return this.database.client.adPlacement.findMany({
      orderBy: [{ inventoryFamily: "asc" }, { key: "asc" }],
    });
  }

  async createPlacement(actorAccountId: string, input: unknown) {
    const data = placementMutationSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const placement = await tx.adPlacement.create({
        data: {
          key: data.key,
          name: data.name,
          inventoryFamily: data.inventoryFamily,
          format: data.format,
          enabled: data.enabled,
          ...(data.config === null ? {} : { config: json(data.config) }),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "AD_PLACEMENT_CREATED",
        entityType: "AdPlacement",
        entityId: placement.id,
        metadata: { key: placement.key, enabled: placement.enabled },
      });
      return placement;
    });
  }

  async updatePlacement(actorAccountId: string, placementId: string, input: unknown) {
    const data = placementPatchSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const placement = await tx.adPlacement.update({
        where: { id: placementId },
        data: {
          ...(data.key !== undefined ? { key: data.key } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.inventoryFamily !== undefined ? { inventoryFamily: data.inventoryFamily } : {}),
          ...(data.format !== undefined ? { format: data.format } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          ...(data.config !== undefined && data.config !== null
            ? { config: json(data.config) }
            : {}),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "AD_PLACEMENT_UPDATED",
        entityType: "AdPlacement",
        entityId: placement.id,
        metadata: { key: placement.key, enabled: placement.enabled },
      });
      return placement;
    });
  }

  async getEventCounters() {
    const grouped = await this.database.client.adEvent.groupBy({
      by: ["eventType"],
      _count: { _all: true },
    });
    return Object.fromEntries(grouped.map((row) => [row.eventType, row._count._all]));
  }

  async listAdvertisers() {
    return this.database.client.advertiser.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
  }

  async createAdvertiser(actorAccountId: string, input: unknown) {
    const data = advertiserCreateSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const advertiser = await tx.advertiser.create({ data });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "ADVERTISER_CREATED",
        entityType: "Advertiser",
        entityId: advertiser.id,
        metadata: { name: advertiser.name, status: advertiser.status },
      });
      return advertiser;
    });
  }

  async updateAdvertiser(actorAccountId: string, advertiserId: string, input: unknown) {
    const data = advertiserPatchSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const advertiser = await tx.advertiser.update({
        where: { id: advertiserId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "ADVERTISER_UPDATED",
        entityType: "Advertiser",
        entityId: advertiser.id,
        metadata: { name: advertiser.name, status: advertiser.status },
      });
      return advertiser;
    });
  }

  async deleteAdvertiser(actorAccountId: string, advertiserId: string) {
    return this.database.client.$transaction(async (tx) => {
      const campaignCount = await tx.campaign.count({ where: { advertiserId } });
      if (campaignCount > 0) throw new Error("ADVERTISER_HAS_CAMPAIGNS");
      const advertiser = await tx.advertiser.delete({ where: { id: advertiserId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "ADVERTISER_DELETED",
        entityType: "Advertiser",
        entityId: advertiser.id,
        metadata: { name: advertiser.name },
      });
      return { deleted: true };
    });
  }

  async listCampaigns() {
    const campaigns = await this.database.client.campaign.findMany({
      include: { advertiser: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    const configs = await this.database.client.directCampaignConfig.findMany({
      where: { campaignId: { in: campaigns.map((item) => item.id) } },
    });
    const byCampaign = new Map(configs.map((item) => [item.campaignId, item]));
    return campaigns.map((campaign) => {
      const direct = byCampaign.get(campaign.id);
      return {
        ...campaign,
        direct: direct
          ? {
              ...direct,
              impressionGoal: direct.impressionGoal === null ? null : Number(direct.impressionGoal),
            }
          : null,
      };
    });
  }

  async createCampaign(actorAccountId: string, input: unknown) {
    const data = campaignCreateSchema.parse(input);
    this.assertDates(data.startsAt, data.endsAt);
    return this.database.client.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          advertiserId: data.advertiserId,
          name: data.name,
          status: data.status,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          budget: data.budget,
          currency: data.currency,
        },
      });
      await this.writeDirectConfig(tx, campaign.id, data.direct);
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CAMPAIGN_CREATED",
        entityType: "Campaign",
        entityId: campaign.id,
        metadata: {
          advertiserId: campaign.advertiserId,
          status: campaign.status,
          budget: data.budget,
          currency: data.currency,
          pricing: json(data.direct.pricing),
        },
      });
      return campaign;
    });
  }

  async updateCampaign(actorAccountId: string, campaignId: string, input: unknown) {
    const data = campaignPatchSchema.parse(input);
    const current = await this.database.client.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    const startsAt = data.startsAt !== undefined ? data.startsAt : current.startsAt;
    const endsAt = data.endsAt !== undefined ? data.endsAt : current.endsAt;
    this.assertDates(startsAt, endsAt);

    return this.database.client.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({
        where: { id: campaignId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
          ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
          ...(data.budget !== undefined ? { budget: data.budget } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
        },
      });
      if (data.direct) await this.writeDirectConfig(tx, campaignId, data.direct);
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CAMPAIGN_UPDATED",
        entityType: "Campaign",
        entityId: campaign.id,
        metadata: {
          status: campaign.status,
          ...(data.budget !== undefined ? { budget: data.budget } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          ...(data.direct ? { pricing: json(data.direct.pricing) } : {}),
        },
      });
      return campaign;
    });
  }

  async deleteCampaign(actorAccountId: string, campaignId: string) {
    return this.database.client.$transaction(async (tx) => {
      const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      const events = await tx.adEvent.count({ where: { campaignId } });
      if (campaign.status !== "DRAFT" || events > 0) throw new Error("CAMPAIGN_NOT_DELETABLE");
      await tx.campaign.delete({ where: { id: campaignId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CAMPAIGN_DELETED",
        entityType: "Campaign",
        entityId: campaignId,
        metadata: { name: campaign.name },
      });
      return { deleted: true };
    });
  }

  async listCreatives(campaignId?: string) {
    const creatives = await this.database.client.creative.findMany({
      ...(campaignId ? { where: { campaignId } } : {}),
      orderBy: [{ createdAt: "desc" }],
    });
    const configs = await this.database.client.directCreativeConfig.findMany({
      where: { creativeId: { in: creatives.map((item) => item.id) } },
    });
    const byCreative = new Map(configs.map((item) => [item.creativeId, item]));
    return creatives.map((creative) => ({
      ...creative,
      direct: byCreative.get(creative.id) ?? null,
    }));
  }

  async createCreative(actorAccountId: string, input: unknown) {
    const data = creativeCreateSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const creative = await tx.creative.create({
        data: {
          campaignId: data.campaignId,
          mediaAssetId: data.mediaAssetId,
          name: data.name,
          type: data.type,
          status: data.status,
          destinationUrl: data.destinationUrl,
          vastTagUrl: data.vastTagUrl,
          headline: data.headline,
          body: data.body,
        },
      });
      await tx.directCreativeConfig.create({
        data: { creativeId: creative.id, ...data.direct },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CREATIVE_CREATED",
        entityType: "Creative",
        entityId: creative.id,
        metadata: { campaignId: creative.campaignId, status: creative.status, type: creative.type },
      });
      return creative;
    });
  }

  async updateCreative(actorAccountId: string, creativeId: string, input: unknown) {
    const data = creativePatchSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const creative = await tx.creative.update({
        where: { id: creativeId },
        data: {
          ...(data.mediaAssetId !== undefined ? { mediaAssetId: data.mediaAssetId } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.destinationUrl !== undefined ? { destinationUrl: data.destinationUrl } : {}),
          ...(data.vastTagUrl !== undefined ? { vastTagUrl: data.vastTagUrl } : {}),
          ...(data.headline !== undefined ? { headline: data.headline } : {}),
          ...(data.body !== undefined ? { body: data.body } : {}),
        },
      });
      if (data.direct) {
        await tx.directCreativeConfig.upsert({
          where: { creativeId },
          update: data.direct,
          create: { creativeId, ...data.direct },
        });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CREATIVE_UPDATED",
        entityType: "Creative",
        entityId: creative.id,
        metadata: { campaignId: creative.campaignId, status: creative.status, type: creative.type },
      });
      return creative;
    });
  }

  async deleteCreative(actorAccountId: string, creativeId: string) {
    return this.database.client.$transaction(async (tx) => {
      const creative = await tx.creative.findUniqueOrThrow({ where: { id: creativeId } });
      const events = await tx.adEvent.count({ where: { creativeId } });
      if (events > 0) {
        const archived = await tx.creative.update({
          where: { id: creativeId },
          data: { status: "ARCHIVED" },
        });
        await this.audit.recordInTransaction(tx, {
          actorAccountId,
          action: "CREATIVE_ARCHIVED",
          entityType: "Creative",
          entityId: creativeId,
          metadata: { campaignId: creative.campaignId },
        });
        return archived;
      }
      await tx.creative.delete({ where: { id: creativeId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CREATIVE_DELETED",
        entityType: "Creative",
        entityId: creativeId,
        metadata: { campaignId: creative.campaignId },
      });
      return { deleted: true };
    });
  }

  async decideDirectAd(context: DirectDecisionContext) {
    if (await this.isEmergencyKilled())
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" };
    const placement = await this.database.client.adPlacement.findUnique({
      where: { key: context.placementKey },
      select: { enabled: true },
    });
    if (!placement?.enabled)
      return { enabled: false as const, reason: "PLACEMENT_DISABLED" };
    const campaigns = await this.database.client.campaign.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (campaigns.length === 0) return { enabled: false as const, reason: "NO_ELIGIBLE_CAMPAIGN" };

    const campaignIds = campaigns.map((item) => item.id);
    const [configs, totalGroups, sessionGroups] = await Promise.all([
      this.database.client.directCampaignConfig.findMany({
        where: { campaignId: { in: campaignIds } },
      }),
      this.database.client.adEvent.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: campaignIds }, eventType: "IMPRESSION" },
        _count: { _all: true },
      }),
      this.database.client.adEvent.groupBy({
        by: ["campaignId"],
        where: {
          campaignId: { in: campaignIds },
          sessionId: context.sessionId,
          eventType: "IMPRESSION",
        },
        _count: { _all: true },
      }),
    ]);
    const configById = new Map(configs.map((item) => [item.campaignId, item]));
    const totals = new Map(totalGroups.map((item) => [item.campaignId, item._count._all]));
    const sessionTotals = new Map(sessionGroups.map((item) => [item.campaignId, item._count._all]));

    const candidates: DirectCampaignCandidate[] = campaigns.flatMap((campaign) => {
      const config = configById.get(campaign.id);
      if (!config) return [];
      const parsed = directCampaignConfigSchema.safeParse({
        priority: config.priority,
        pricing: config.pricing,
        impressionGoal: config.impressionGoal === null ? null : Number(config.impressionGoal),
        frequencyCap: config.frequencyCap,
        pacing: config.pacing,
        targeting: config.targeting,
      });
      if (!parsed.success) return [];
      return [
        {
          id: campaign.id,
          priority: parsed.data.priority,
          status: campaign.status,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          impressionGoal: parsed.data.impressionGoal,
          totalImpressions: totals.get(campaign.id) ?? 0,
          frequencyCap: parsed.data.frequencyCap,
          sessionImpressions: sessionTotals.get(campaign.id) ?? 0,
          pacing: parsed.data.pacing,
          targeting: parsed.data.targeting,
        },
      ];
    });

    const selected = chooseDirectCampaign(candidates, context);
    if (!selected) return { enabled: false as const, reason: "NO_ELIGIBLE_CAMPAIGN" };
    const campaign = campaigns.find((item) => item.id === selected.id);
    if (!campaign) return { enabled: false as const, reason: "NO_ELIGIBLE_CAMPAIGN" };

    const creatives = await this.database.client.creative.findMany({
      where: { campaignId: campaign.id, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (creatives.length === 0) return { enabled: false as const, reason: "NO_ACTIVE_CREATIVE" };
    const creativeConfigs = await this.database.client.directCreativeConfig.findMany({
      where: { creativeId: { in: creatives.map((item) => item.id) } },
    });
    const creativeConfigById = new Map(creativeConfigs.map((item) => [item.creativeId, item]));
    const creative = creatives.find((item) => creativeConfigById.has(item.id)) ?? creatives[0];
    if (!creative) return { enabled: false as const, reason: "NO_ACTIVE_CREATIVE" };
    const direct = creativeConfigById.get(creative.id) ?? null;

    return {
      enabled: true as const,
      campaign: { id: campaign.id, name: campaign.name },
      creative: {
        id: creative.id,
        type: creative.type,
        destinationUrl: creative.destinationUrl,
        vastTagUrl: creative.vastTagUrl,
        headline: creative.headline,
        body: creative.body,
        mediaAssetId: creative.mediaAssetId,
        assetUrl: direct?.assetUrl ?? null,
        width: direct?.width ?? null,
        height: direct?.height ?? null,
        approvedReference: direct?.approvedReference ?? null,
      },
    };
  }

  async recordDirectEvent(input: {
    placementKey: string;
    campaignId: string;
    creativeId: string;
    eventType: "REQUEST" | "FILL" | "IMPRESSION" | "CLICK" | "ERROR";
    sessionId: string;
    requestId?: string;
  }) {
    const placement = await this.database.client.adPlacement.findUnique({
      where: { key: input.placementKey },
      select: { id: true },
    });
    if (!placement) return null;
    return this.database.client.adEvent.create({
      data: {
        placementId: placement.id,
        campaignId: input.campaignId,
        creativeId: input.creativeId,
        eventType: input.eventType,
        sessionId: input.sessionId,
        requestId: input.requestId ?? null,
        metadata: { provider: "DIRECT" },
      },
      select: { id: true },
    });
  }

  private async writeDirectConfig(
    tx: Prisma.TransactionClient,
    campaignId: string,
    data: DirectCampaignConfigInput,
  ) {
    return tx.directCampaignConfig.upsert({
      where: { campaignId },
      update: {
        priority: data.priority,
        pricing: json(data.pricing),
        impressionGoal: data.impressionGoal === null ? null : BigInt(data.impressionGoal),
        frequencyCap: data.frequencyCap,
        pacing: data.pacing,
        targeting: json(data.targeting),
      },
      create: {
        campaignId,
        priority: data.priority,
        pricing: json(data.pricing),
        impressionGoal: data.impressionGoal === null ? null : BigInt(data.impressionGoal),
        frequencyCap: data.frequencyCap,
        pacing: data.pacing,
        targeting: json(data.targeting),
      },
    });
  }

  private assertDates(startsAt: Date | null, endsAt: Date | null) {
    if (startsAt && endsAt && endsAt <= startsAt) throw new Error("INVALID_CAMPAIGN_DATES");
  }
}
