import { Prisma } from "@ayin/db";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  lockAdminAccountWrite,
  type AccountWriteActor,
} from "../admin/admin-account-write-authority.js";
import { DatabaseService } from "../database/database.service.js";
import {
  VideoPolicyService,
  type VideoPolicyContext,
} from "../video-policy/video-policy.service.js";
import { GamProductionService, type GamVideoSlot } from "./gam-production.service.js";
import { resolveVideoAdPolicy } from "./video-ad-policy.js";

export const videoAdSettingsSchema = z.object({
  masterEnabled: z.boolean(),
  provider: z.enum(["GOOGLE_IMA"]),
  preRollEnabled: z.boolean(),
  midRollEnabled: z.boolean(),
  postRollEnabled: z.boolean(),
  midRollEverySec: z.number().int().min(60).max(7200),
  frequencyCapPerSession: z.number().int().min(0).max(50),
  externalVastTagUrl: z.string().url().max(4096).nullable(),
  houseCreativeUrl: z.string().url().max(4096).nullable(),
  houseClickUrl: z.string().url().max(4096).nullable(),
});

export type VideoAdSettings = z.infer<typeof videoAdSettingsSchema>;
const expectedVersion = z.string().datetime({ offset: true }).nullable().optional();
const settingsWriteSchema = videoAdSettingsSchema.extend({ expectedUpdatedAt: expectedVersion });
const overrideDeleteSchema = z.object({ expectedUpdatedAt: expectedVersion }).strict();

export const defaultVideoAdSettings: VideoAdSettings = {
  masterEnabled: false,
  provider: "GOOGLE_IMA",
  preRollEnabled: true,
  midRollEnabled: false,
  postRollEnabled: false,
  midRollEverySec: 600,
  frequencyCapPerSession: 3,
  externalVastTagUrl: null,
  houseCreativeUrl: null,
  houseClickUrl: null,
};

export const overrideSchema = z.object({
  expectedUpdatedAt: expectedVersion,
  enabled: z.boolean().nullable().optional(),
  preRollEnabled: z.boolean().nullable().optional(),
  midRollEnabled: z.boolean().nullable().optional(),
  postRollEnabled: z.boolean().nullable().optional(),
  provider: z.enum(["GOOGLE_IMA"]).nullable().optional(),
  vastTagUrl: z.string().url().max(4096).nullable().optional(),
  midRollEverySec: z.number().int().min(60).max(7200).nullable().optional(),
});

type VideoAdOverrideInput = z.infer<typeof overrideSchema>;

const overrideReadSelection = {
  id: true,
  channelId: true,
  videoId: true,
  enabled: true,
  preRollEnabled: true,
  midRollEnabled: true,
  postRollEnabled: true,
  provider: true,
  vastTagUrl: true,
  midRollEverySec: true,
  updatedAt: true,
} satisfies Prisma.VideoAdOverrideSelect;

export const adEventSchema = z.object({
  videoId: z.string().uuid(),
  slot: z.enum(["PRE_ROLL", "MID_ROLL", "POST_ROLL"]),
  eventType: z.enum([
    "REQUEST",
    "FILL",
    "IMPRESSION",
    "START",
    "QUARTILE_25",
    "MIDPOINT",
    "QUARTILE_75",
    "COMPLETE",
    "CLICK",
    "ERROR",
  ]),
  requestId: z.string().trim().min(1).max(120).nullable().optional(),
  sessionId: z.string().trim().min(1).max(120).nullable().optional(),
  provider: z.enum(["GOOGLE_IMA"]),
  source: z.enum(["GOOGLE_AD_MANAGER", "EXTERNAL_VAST", "HOUSE"]).nullable().optional(),
  errorCode: z.string().trim().max(120).nullable().optional(),
});

export type VideoAdEventInput = z.infer<typeof adEventSchema>;

@Injectable()
export class VideoAdService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(GamProductionService) private readonly gam: GamProductionService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async getSettings(): Promise<VideoAdSettings> {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
      select: { value: true },
    });
    const parsed = videoAdSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : defaultVideoAdSettings;
  }

  async updateSettings(
    actor: AccountWriteActor,
    input: unknown,
  ): Promise<VideoAdSettings | { settings: VideoAdSettings; updatedAt: Date; source: "STORED" }> {
    const { expectedUpdatedAt, ...settings } = settingsWriteSchema.parse(input);
    const value = settings as unknown as Prisma.InputJsonValue;
    return this.database.client.$transaction(async (tx) => {
      await this.writeAuthority(tx, actor);
      const current = await this.lockConfiguration(tx, "SETTINGS");
      await this.writeAuthority(tx, actor);
      this.checkConfigurationVersion(current, expectedUpdatedAt);
      const updatedAt = this.nextConfigurationVersion(current?.updatedAt);
      await tx.platformSetting.upsert({
        where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
        update: { value, valueType: "JSON", schemaVersion: 1, updatedAt },
        create: {
          namespace: "ADVERTISING",
          key: "videoAdsV1",
          valueType: "JSON",
          value,
          updatedAt,
          schemaVersion: 1,
          description: "Task 19 typed in-player video advertising defaults.",
        },
      });
      await this.writeAuthority(tx, actor);
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
        action: "VIDEO_AD_SETTINGS_UPDATED",
        entityType: "PlatformSetting",
        entityId: "ADVERTISING/videoAdsV1",
        metadata: {
          masterEnabled: settings.masterEnabled,
          preRollEnabled: settings.preRollEnabled,
          midRollEnabled: settings.midRollEnabled,
          postRollEnabled: settings.postRollEnabled,
          frequencyCapPerSession: settings.frequencyCapPerSession,
        },
      });
      return expectedUpdatedAt !== undefined
        ? { settings, updatedAt, source: "STORED" as const }
        : settings;
    });
  }

  async listOverrides() {
    const rows = await this.database.client.videoAdOverride.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: overrideReadSelection,
    });
    return this.overrideFacts(this.database.client, rows);
  }

  async settingsRecord() {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
      select: { value: true, updatedAt: true },
    });
    const parsed = videoAdSettingsSchema.safeParse(row?.value);
    return {
      settings: parsed.success ? parsed.data : defaultVideoAdSettings,
      source: !row ? "DEFAULT" : parsed.success ? "STORED" : "INVALID_STORED_DEFAULT",
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async overrideDirectory(input: {
    page?: number | undefined;
    query?: string | undefined;
    targetType?: "CHANNEL" | "VIDEO" | undefined;
  }) {
    const page = input.page ?? 1,
      take = 25,
      query = input.query?.trim();
    const typeClause =
      input.targetType === "CHANNEL"
        ? Prisma.sql`o."channelId" IS NOT NULL`
        : input.targetType === "VIDEO"
          ? Prisma.sql`o."videoId" IS NOT NULL`
          : Prisma.sql`TRUE`;
    const queryClause = query
      ? Prisma.sql`(
      position(lower(${query}) in lower(COALESCE(c."name", ''))) > 0 OR
      position(lower(${query}) in lower(COALESCE(c."handle", ''))) > 0 OR
      position(lower(${query}) in lower(COALESCE(v."title", ''))) > 0
    )`
      : Prisma.sql`TRUE`;
    const from = Prisma.sql`FROM "VideoAdOverride" o LEFT JOIN "Channel" c ON c."id"=o."channelId"
      LEFT JOIN "Video" v ON v."id"=o."videoId" WHERE ${typeClause} AND ${queryClause}`;
    return this.database.client.$transaction(
      async (tx) => {
        const [counts, ids] = await Promise.all([
          tx.$queryRaw<Array<{ total: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS total ${from}`,
          ),
          tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT o."id" ${from}
          ORDER BY o."updatedAt" DESC, o."id" DESC LIMIT ${take} OFFSET ${(page - 1) * take}`),
        ]);
        const total = Number(counts[0]?.total ?? 0);
        const rows = await tx.videoAdOverride.findMany({
          where: { id: { in: ids.map((x) => x.id) } },
          select: overrideReadSelection,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take,
        });
        return {
          items: await this.overrideFacts(tx, rows),
          pagination: {
            page,
            take,
            total,
            totalPages: Math.ceil(total / take),
            hasNext: page * take < total,
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async overrideRecord(id: string) {
    return this.database.client.$transaction(
      async (tx) => {
        const row = await tx.videoAdOverride.findUnique({
          where: { id },
          select: overrideReadSelection,
        });
        if (!row) throw new NotFoundException("Advertising override unavailable.");
        return (await this.overrideFacts(tx, [row]))[0];
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async targetRecord(kind: "CHANNEL" | "VIDEO", targetId: string) {
    return this.database.client.$transaction(
      async (tx) => {
        const target =
          kind === "CHANNEL"
            ? await tx.channel.findUnique({
                where: { id: targetId },
                select: { id: true, name: true, handle: true, status: true },
              })
            : await tx.video.findUnique({
                where: { id: targetId },
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  status: true,
                  channel: { select: { id: true, name: true, handle: true } },
                },
              });
        if (!target) throw new NotFoundException("Advertising target unavailable.");
        const row = await tx.videoAdOverride.findUnique({
          where: kind === "CHANNEL" ? { channelId: targetId } : { videoId: targetId },
          select: overrideReadSelection,
        });
        return { kind, target, override: row ?? null };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  private async overrideFacts(
    client: Prisma.TransactionClient,
    rows: Array<Prisma.VideoAdOverrideGetPayload<{ select: typeof overrideReadSelection }>>,
  ) {
    const channelIds = rows.flatMap((row) => (row.channelId ? [row.channelId] : []));
    const videoIds = rows.flatMap((row) => (row.videoId ? [row.videoId] : []));
    const [channels, videos] = await Promise.all([
      channelIds.length
        ? client.channel.findMany({
            where: { id: { in: channelIds } },
            select: { id: true, name: true, handle: true, status: true },
          })
        : Promise.resolve([]),
      videoIds.length
        ? client.video.findMany({
            where: { id: { in: videoIds } },
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              channel: { select: { id: true, name: true, handle: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const channelsById = new Map(channels.map((item) => [item.id, item]));
    const videosById = new Map(videos.map((item) => [item.id, item]));
    return rows.map((row) => ({
      ...row,
      channel: row.channelId ? (channelsById.get(row.channelId) ?? null) : null,
      video: row.videoId ? (videosById.get(row.videoId) ?? null) : null,
    }));
  }

  async getDecision(videoId: string, origin: string | null, context: VideoPolicyContext = {}) {
    const killSwitch = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
      select: { value: true },
    });
    if (killSwitch?.value === true) {
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    }

    const video = await this.database.client.video.findFirst({
      where: {
        id: videoId,
        status: "PUBLISHED",
        visibility: { in: ["PUBLIC", "UNLISTED"] },
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      select: { id: true, channelId: true, slug: true, durationMs: true },
    });
    if (!video || !(await this.videoPolicy.decide(video.id, context)).allowed)
      return { enabled: false, reason: "VIDEO_NOT_ELIGIBLE" as const };

    const [settings, channelOverride, videoOverride] = await Promise.all([
      this.getSettings(),
      this.database.client.videoAdOverride.findUnique({ where: { channelId: video.channelId } }),
      this.database.client.videoAdOverride.findUnique({ where: { videoId: video.id } }),
    ]);
    if (!settings.masterEnabled) return { enabled: false, reason: "ADS_DISABLED" as const };

    const resolved = resolveVideoAdPolicy(settings, channelOverride, videoOverride);
    if (!resolved.enabled) return { enabled: false, reason: "CONTENT_OVERRIDE_DISABLED" as const };

    const explicitTagUrl = resolved.vastTagUrl ?? settings.externalVastTagUrl;
    let source: "GOOGLE_AD_MANAGER" | "EXTERNAL_VAST" | "HOUSE" | null = null;
    let tagUrl: string | null = explicitTagUrl;
    let tagUrls: Partial<Record<GamVideoSlot, string>> | undefined;

    if (explicitTagUrl) {
      source = "EXTERNAL_VAST";
    } else {
      const descriptionUrl = this.watchUrl(origin, video.slug);
      if (descriptionUrl) {
        const [preRoll, midRoll, postRoll] = await Promise.all([
          this.gam.buildVideoTagUrl({ descriptionUrl, slot: "PRE_ROLL" }),
          this.gam.buildVideoTagUrl({ descriptionUrl, slot: "MID_ROLL" }),
          this.gam.buildVideoTagUrl({ descriptionUrl, slot: "POST_ROLL" }),
        ]);
        if (preRoll && midRoll && postRoll) {
          source = "GOOGLE_AD_MANAGER";
          tagUrl = preRoll;
          tagUrls = { PRE_ROLL: preRoll, MID_ROLL: midRoll, POST_ROLL: postRoll };
        }
      }
    }

    if (!tagUrl) {
      tagUrl = this.houseTagUrl(origin, settings);
      if (tagUrl) source = "HOUSE";
    }
    if (!tagUrl || !source) {
      return { enabled: false, reason: "NO_AD_SOURCE_CONFIGURED" as const };
    }

    return {
      enabled: true as const,
      provider: resolved.provider,
      source,
      tagUrl,
      ...(tagUrls ? { tagUrls } : {}),
      preRollEnabled: resolved.preRollEnabled,
      midRollEnabled:
        resolved.midRollEnabled && (video.durationMs ?? 0) >= resolved.midRollEverySec * 1000,
      postRollEnabled: resolved.postRollEnabled,
      midRollEverySec: resolved.midRollEverySec,
      frequencyCapPerSession: settings.frequencyCapPerSession,
      attribution: { videoId: video.id, channelId: video.channelId },
    };
  }

  async upsertOverride(
    actor: AccountWriteActor,
    target: { channelId?: string; videoId?: string },
    input: unknown,
  ) {
    const { expectedUpdatedAt, ...data } = overrideSchema.parse(input);
    if ((target.channelId ? 1 : 0) + (target.videoId ? 1 : 0) !== 1) {
      throw new Error("Exactly one video ad override target is required.");
    }
    const writeData = this.overrideWriteData(data, actor.accountId);
    return this.database.client.$transaction(async (tx) => {
      await this.writeAuthority(tx, actor);
      await this.lockOverrideTarget(tx, target);
      await this.writeAuthority(tx, actor);
      const current = await this.lockConfiguration(tx, "OVERRIDE", target);
      await this.writeAuthority(tx, actor);
      this.checkConfigurationVersion(current, expectedUpdatedAt);
      const versionedWrite = {
        ...writeData,
        updatedAt: this.nextConfigurationVersion(current?.updatedAt),
      };
      let row;
      let entityType: "Channel" | "Video";
      let entityId: string;
      if (target.channelId) {
        await tx.channel.findUniqueOrThrow({ where: { id: target.channelId } });
        row = await tx.videoAdOverride.upsert({
          where: { channelId: target.channelId },
          update: versionedWrite,
          create: { channelId: target.channelId, ...versionedWrite },
          select: overrideReadSelection,
        });
        entityType = "Channel";
        entityId = target.channelId;
      } else {
        const targetVideoId = target.videoId as string;
        await tx.video.findUniqueOrThrow({ where: { id: targetVideoId } });
        row = await tx.videoAdOverride.upsert({
          where: { videoId: targetVideoId },
          update: versionedWrite,
          create: { videoId: targetVideoId, ...versionedWrite },
          select: overrideReadSelection,
        });
        entityType = "Video";
        entityId = targetVideoId;
      }
      await this.writeAuthority(tx, actor);
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
        action: "VIDEO_AD_OVERRIDE_UPDATED",
        entityType,
        entityId,
        metadata: data,
      });
      return row;
    });
  }

  async deleteOverride(
    actor: AccountWriteActor,
    target: { channelId?: string; videoId?: string },
    input: unknown = {},
  ) {
    const { expectedUpdatedAt } = overrideDeleteSchema.parse(input);
    if ((target.channelId ? 1 : 0) + (target.videoId ? 1 : 0) !== 1) {
      throw new Error("Exactly one video ad override target is required.");
    }
    return this.database.client.$transaction(async (tx) => {
      await this.writeAuthority(tx, actor);
      await this.lockOverrideTarget(tx, target, false);
      await this.writeAuthority(tx, actor);
      const current = await this.lockConfiguration(tx, "OVERRIDE", target);
      await this.writeAuthority(tx, actor);
      this.checkConfigurationVersion(current, expectedUpdatedAt);
      let result: { count: number };
      let entityType: "Channel" | "Video";
      let entityId: string;
      if (target.channelId) {
        result = await tx.videoAdOverride.deleteMany({ where: { channelId: target.channelId } });
        entityType = "Channel";
        entityId = target.channelId;
      } else {
        const targetVideoId = target.videoId as string;
        result = await tx.videoAdOverride.deleteMany({ where: { videoId: targetVideoId } });
        entityType = "Video";
        entityId = targetVideoId;
      }
      await this.writeAuthority(tx, actor);
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
        action: "VIDEO_AD_OVERRIDE_REMOVED",
        entityType,
        entityId,
        metadata: { deleted: result.count },
      });
      return { deleted: result.count > 0 };
    });
  }

  private writeAuthority(tx: Prisma.TransactionClient, actor: AccountWriteActor) {
    return lockAdminAccountWrite(tx, actor, actor.accountId, undefined, ["AD_MANAGER"]);
  }

  private async lockConfiguration(
    tx: Prisma.TransactionClient,
    kind: "SETTINGS" | "OVERRIDE",
    target?: { channelId?: string; videoId?: string },
  ) {
    const key =
      kind === "SETTINGS"
        ? "ayin:video-ads:settings"
        : `ayin:video-ads:${target?.channelId ? "channel" : "video"}:${target?.channelId ?? target?.videoId}`;
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text /* ayin-admin-video-ad-config-lock */`,
    );
    const rows =
      kind === "SETTINGS"
        ? await tx.$queryRaw<Array<{ updatedAt: Date }>>(
            Prisma.sql`SELECT "updatedAt" FROM "PlatformSetting" WHERE "namespace"='ADVERTISING' AND "key"='videoAdsV1' FOR UPDATE /* ayin-admin-video-ad-config-lock */`,
          )
        : target?.channelId
          ? await tx.$queryRaw<Array<{ updatedAt: Date }>>(
              Prisma.sql`SELECT "updatedAt" FROM "VideoAdOverride" WHERE "channelId"=${target.channelId}::uuid FOR UPDATE /* ayin-admin-video-ad-config-lock */`,
            )
          : await tx.$queryRaw<Array<{ updatedAt: Date }>>(
              Prisma.sql`SELECT "updatedAt" FROM "VideoAdOverride" WHERE "videoId"=${target?.videoId}::uuid FOR UPDATE /* ayin-admin-video-ad-config-lock */`,
            );
    return rows[0];
  }

  private checkConfigurationVersion(
    current: { updatedAt: Date } | undefined,
    expected: string | null | undefined,
  ) {
    if (expected === undefined) return;
    if (
      expected === null
        ? Boolean(current)
        : !current || current.updatedAt.getTime() !== new Date(expected).getTime()
    )
      throw new ConflictException(
        "Advertising configuration changed. Read the original target before reviewing the operation.",
      );
  }

  private nextConfigurationVersion(previous?: Date) {
    return new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1));
  }

  private async lockOverrideTarget(
    tx: Prisma.TransactionClient,
    target: { channelId?: string; videoId?: string },
    requireTarget = true,
  ) {
    const rows = target.channelId
      ? await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "Channel" WHERE "id" = ${target.channelId}::uuid FOR SHARE /* ayin-admin-video-ad-target-lock */`,
        )
      : await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "Video" WHERE "id" = ${target.videoId}::uuid FOR SHARE /* ayin-admin-video-ad-target-lock */`,
        );
    if (!rows.length && requireTarget)
      throw new NotFoundException("Advertising target unavailable.");
  }

  async recordEvent(input: VideoAdEventInput) {
    const placement = await this.database.client.adPlacement.upsert({
      where: { key: `player_${input.slot.toLowerCase()}` },
      update: {},
      create: {
        key: `player_${input.slot.toLowerCase()}`,
        name: `Player ${input.slot.replaceAll("_", " ").toLowerCase()}`,
        inventoryFamily: "IN_PLAYER_VIDEO",
        format: input.slot,
        enabled: true,
        config: { system: true, task: 19 },
      },
    });
    return this.database.client.adEvent.create({
      data: {
        placementId: placement.id,
        videoId: input.videoId,
        eventType: input.eventType,
        requestId: input.requestId ?? null,
        sessionId: input.sessionId ?? null,
        metadata: {
          provider: input.provider,
          ...(input.source ? { source: input.source } : {}),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        },
      },
      select: { id: true },
    });
  }

  getHouseVast(settings: VideoAdSettings) {
    if (!settings.houseCreativeUrl) return null;
    const click = settings.houseClickUrl
      ? `<ClickThrough><![CDATA[${this.xml(settings.houseClickUrl)}]]></ClickThrough>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"><Ad id="ayin-house-v1"><InLine><AdSystem>AYIN House</AdSystem><AdTitle>AYIN House Test</AdTitle><Impression><![CDATA[]]></Impression><Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles><MediaFile delivery="progressive" type="video/mp4"><![CDATA[${this.xml(settings.houseCreativeUrl)}]]></MediaFile></MediaFiles><VideoClicks>${click}</VideoClicks></Linear></Creative></Creatives></InLine></Ad></VAST>`;
  }

  private overrideWriteData(data: VideoAdOverrideInput, actorAccountId: string) {
    return {
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.preRollEnabled !== undefined ? { preRollEnabled: data.preRollEnabled } : {}),
      ...(data.midRollEnabled !== undefined ? { midRollEnabled: data.midRollEnabled } : {}),
      ...(data.postRollEnabled !== undefined ? { postRollEnabled: data.postRollEnabled } : {}),
      ...(data.provider !== undefined ? { provider: data.provider } : {}),
      ...(data.vastTagUrl !== undefined ? { vastTagUrl: data.vastTagUrl } : {}),
      ...(data.midRollEverySec !== undefined ? { midRollEverySec: data.midRollEverySec } : {}),
      updatedBy: actorAccountId,
    };
  }

  private houseTagUrl(origin: string | null, settings: VideoAdSettings) {
    if (!settings.houseCreativeUrl || !origin) return null;
    return `${origin.replace(/\/$/u, "")}/ads/house/vast`;
  }

  private watchUrl(origin: string | null, slug: string) {
    if (!origin) return null;
    try {
      return new URL(`/watch/${encodeURIComponent(slug)}`, origin).toString();
    } catch {
      return null;
    }
  }

  private xml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
}
