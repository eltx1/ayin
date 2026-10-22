import { createHash } from "node:crypto";
import { Prisma } from "@ayin/db";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";

import { publicVideoEligibility } from "../creator/public-video-read.js";
import { kidsSafeHref } from "../kids/kids-policy.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";
import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import {
  defaultProductControls,
  productControlsSchema,
  type CreateHomeRow,
  type HomeRowPatch,
  type ProductControls,
  type UpdateProductControls,
} from "./admin-product-config.js";
import { adminBadRequest } from "./admin.errors.js";

const PRODUCT_CONTROLS_KEY = "productControls";

export function homeRowsRevision(rows: Array<{ id: string; updatedAt: Date }>): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows
          .map((row) => [row.id, row.updatedAt.toISOString()])
          .sort(([left], [right]) => left!.localeCompare(right!)),
      ),
    )
    .digest("hex");
}

function homeRowConflict(code: string, message: string) {
  return new HttpException({ error: { code, message } }, HttpStatus.CONFLICT);
}

@Injectable()
export class AdminProductService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async getAdminSnapshot() {
    const [rows, controls, homeDiscoveryMode] = await Promise.all([
      this.database.client.homeRowConfig.findMany({
        orderBy: [{ position: "asc" }, { key: "asc" }],
        include: {
          manualItems: { orderBy: { position: "asc" } },
          regionTargets: { orderBy: { regionCode: "asc" } },
        },
      }),
      this.getPublicControls(),
      this.settings.get("homeDiscoveryMode"),
    ]);

    const targets: Array<{ entityType: string; entityId: string }> = rows.flatMap(
      (row) => row.manualItems,
    );
    if (controls.hero.entityType && controls.hero.entityId) {
      targets.push({ entityType: controls.hero.entityType, entityId: controls.hero.entityId });
    }
    const selectedTargets = await this.selectedTargets(targets);
    return {
      selectedTargets,
      homeDiscoveryMode,
      homeRowsRevision: homeRowsRevision(rows),
      rows: rows.map((row) => ({
        ...row,
        targetRegions: row.regionTargets.map((target) => target.regionCode),
      })),
      controls,
    };
  }

  async createRow(actorAccountId: string, input: CreateHomeRow) {
    const targetRegions = [...new Set(input.targetRegions)].sort();
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          const rows = await tx.homeRowConfig.findMany({
            orderBy: [{ position: "asc" }, { key: "asc" }],
            include: {
              manualItems: { orderBy: { position: "asc" } },
              regionTargets: { orderBy: { regionCode: "asc" } },
            },
          });
          const existing = rows.find((row) => row.id === input.requestId);
          if (existing) {
            const sameRequest =
              existing.key === input.key &&
              existing.title === input.title &&
              existing.source === input.source &&
              existing.audience === input.audience &&
              existing.enabled === input.enabled &&
              existing.maxItems === input.maxItems &&
              existing.regionPersonalizationRequired === input.regionPersonalizationRequired &&
              JSON.stringify(existing.regionTargets.map((target) => target.regionCode).sort()) ===
                JSON.stringify(targetRegions);
            if (!sameRequest)
              throw homeRowConflict(
                "HOME_ROW_REQUEST_CONFLICT",
                "This creation request already saved a different section. Reload the saved sections.",
              );
            return {
              row: { ...existing, targetRegions },
              homeRowsRevision: homeRowsRevision(rows),
              replayed: true,
            };
          }
          if (rows.some((row) => row.key === input.key))
            throw homeRowConflict("HOME_ROW_KEY_EXISTS", "A section already uses this key.");
          if (homeRowsRevision(rows) !== input.expectedRowsRevision)
            throw homeRowConflict(
              "HOME_ROWS_CHANGED",
              "The saved sections changed. Reload and review them before creating a section.",
            );
          if (rows.length >= 100)
            throw homeRowConflict("HOME_ROW_LIMIT_REACHED", "Use up to 100 home sections.");

          const mode = await this.settings.getResolvedInTransaction(tx, "homeDiscoveryMode");
          if (!rows.length && mode.value === "INHERIT" && !input.confirmManagedTransition)
            throw homeRowConflict(
              "HOME_MODE_REVIEW_REQUIRED",
              "Creating the first section changes the inherited home to Managed. Review that change first.",
            );
          const row = await tx.homeRowConfig.create({
            data: {
              id: input.requestId,
              key: input.key,
              title: input.title,
              source: input.source,
              audience: input.audience,
              enabled: input.enabled,
              maxItems: input.maxItems,
              regionPersonalizationRequired: input.regionPersonalizationRequired,
              position: rows.reduce((maximum, item) => Math.max(maximum, item.position), -1) + 1,
              ...(targetRegions.length
                ? { regionTargets: { create: targetRegions.map((regionCode) => ({ regionCode })) } }
                : {}),
            },
            include: {
              manualItems: { orderBy: { position: "asc" } },
              regionTargets: { orderBy: { regionCode: "asc" } },
            },
          });
          await this.audit.recordInTransaction(tx, {
            actorAccountId,
            action: "HOME_ROW_CREATED",
            entityType: "HomeRowConfig",
            entityId: row.id,
            reason: input.reason,
            metadata: {
              key: row.key,
              source: row.source,
              audience: row.audience,
              enabled: row.enabled,
              maxItems: row.maxItems,
              targetRegions,
              inheritedModeChanged: rows.length === 0 && mode.value === "INHERIT",
            },
          });
          return {
            row: { ...row, targetRegions },
            homeRowsRevision: homeRowsRevision([...rows, row]),
            replayed: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      )
        throw homeRowConflict(
          "HOME_ROWS_CHANGED",
          "Another section change completed. Reload the saved sections before retrying.",
        );
      throw error;
    }
  }

  private async rowRevision(tx: Prisma.TransactionClient) {
    return homeRowsRevision(
      await tx.homeRowConfig.findMany({ select: { id: true, updatedAt: true } }),
    );
  }

  // Recover labels independently of search pages and public eligibility. A
  // removed/private selection remains the operator's exact choice; it is never
  // silently replaced with an available search result.
  private async selectedTargets(targets: Array<{ entityType: string; entityId: string }>) {
    if (!targets.length) return [];
    const ids = (type: string) => [
      ...new Set(
        targets.filter((target) => target.entityType === type).map((target) => target.entityId),
      ),
    ];
    const [videos, channels, tv, playlists] = await Promise.all([
      this.database.client.video.findMany({
        where: { id: { in: ids("VIDEO") } },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          visibility: true,
          channel: { select: { handle: true } },
        },
      }),
      this.database.client.channel.findMany({
        where: { id: { in: ids("CHANNEL") } },
        select: { id: true, name: true, handle: true, status: true },
      }),
      this.database.client.creatorTvChannel.findMany({
        where: { id: { in: ids("CREATOR_TV") } },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          channel: { select: { handle: true } },
        },
      }),
      this.database.client.playlist.findMany({
        where: { id: { in: ids("PLAYLIST") } },
        select: {
          id: true,
          name: true,
          slug: true,
          visibility: true,
          deletedAt: true,
          channel: { select: { handle: true } },
        },
      }),
    ]);
    return [
      ...videos.map((row) => ({
        entityType: "VIDEO",
        entityId: row.id,
        label: row.title,
        detail: `@${row.channel.handle} · ${row.slug} · ${row.status} · ${row.visibility}`,
      })),
      ...channels.map((row) => ({
        entityType: "CHANNEL",
        entityId: row.id,
        label: row.name,
        detail: `@${row.handle} · ${row.status}`,
      })),
      ...tv.map((row) => ({
        entityType: "CREATOR_TV",
        entityId: row.id,
        label: row.name,
        detail: `@${row.channel.handle} · ${row.slug} · ${row.status}`,
      })),
      ...playlists.map((row) => ({
        entityType: "PLAYLIST",
        entityId: row.id,
        label: row.name,
        detail: `@${row.channel.handle} · ${row.slug} · ${row.deletedAt ? "DELETED" : row.visibility}`,
      })),
    ];
  }

  async getPublicControls(): Promise<ProductControls> {
    const setting = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "DISCOVERY", key: PRODUCT_CONTROLS_KEY } },
      select: { value: true },
    });
    if (!setting) return defaultProductControls;
    const parsed = productControlsSchema.safeParse(setting.value);
    return parsed.success ? parsed.data : defaultProductControls;
  }

  async getPublicSnapshot(context: VideoPolicyContext & { accountId?: string | undefined } = {}) {
    const controls = await this.getPublicControls();
    // Match authenticated Home's current default profile, never a client-provided
    // Kids/adult assertion. A missing/deleted default profile must fail closed.
    const profile = context.accountId
      ? await this.database.client.viewerProfile.findFirst({
          where: { accountId: context.accountId, isDefault: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { isKids: true },
        })
      : null;
    const resolvedHero =
      context.accountId && !profile
        ? null
        : await this.resolveHero(controls, {
            ...context,
            isKidsProfile: context.isKidsProfile === true || profile?.isKids === true,
          });
    return {
      ...controls,
      // The configured private/unavailable entity ID is an Admin editing detail.
      hero: resolvedHero ? controls.hero : { entityType: null, entityId: null },
      resolvedHero,
    };
  }

  async patchRow(actorAccountId: string, rowId: string, input: HomeRowPatch) {
    const reason = input.reason;
    const patch: Prisma.HomeRowConfigUpdateInput = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.source !== undefined) patch.source = input.source;
    if (input.audience !== undefined) patch.audience = input.audience;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.maxItems !== undefined) patch.maxItems = input.maxItems;
    if (input.regionPersonalizationRequired !== undefined) {
      patch.regionPersonalizationRequired = input.regionPersonalizationRequired;
    }
    if (input.targetRegions !== undefined) {
      const targetRegions = [...new Set(input.targetRegions)];
      patch.regionTargets = {
        deleteMany: {},
        ...(targetRegions.length
          ? { create: targetRegions.map((regionCode) => ({ regionCode })) }
          : {}),
      };
    }

    const existing = await this.database.client.homeRowConfig.findUnique({ where: { id: rowId } });
    if (!existing) throw adminBadRequest("HOME_ROW_NOT_FOUND", "Home row was not found.");

    return this.database.client.$transaction(async (tx) => {
      const row = await tx.homeRowConfig.update({
        where: { id: rowId },
        data: patch,
        include: { regionTargets: { orderBy: { regionCode: "asc" } } },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "HOME_ROW_UPDATED",
        entityType: "HomeRowConfig",
        entityId: rowId,
        reason,
        metadata: {
          key: existing.key,
          fields: Object.keys(patch),
          targetRegions: row.regionTargets.map((target) => target.regionCode),
        },
      });
      return {
        ...row,
        targetRegions: row.regionTargets.map((target) => target.regionCode),
        homeRowsRevision: await this.rowRevision(tx),
      };
    });
  }

  async reorderRows(actorAccountId: string, rowIds: string[], reason: string) {
    if (new Set(rowIds).size !== rowIds.length) {
      throw adminBadRequest("DUPLICATE_HOME_ROW", "Home row ordering contains duplicates.");
    }
    const count = await this.database.client.homeRowConfig.count({ where: { id: { in: rowIds } } });
    if (count !== rowIds.length)
      throw adminBadRequest("HOME_ROW_NOT_FOUND", "One or more home rows were not found.");

    return this.database.client.$transaction(async (tx) => {
      for (const [position, rowId] of rowIds.entries()) {
        await tx.homeRowConfig.update({ where: { id: rowId }, data: { position } });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "HOME_ROWS_REORDERED",
        entityType: "HomeRowConfig",
        reason,
        metadata: { rowIds },
      });
      return { rowIds, homeRowsRevision: await this.rowRevision(tx) };
    });
  }

  async replaceManualItems(
    actorAccountId: string,
    rowId: string,
    items: Array<{ entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST"; entityId: string }>,
    reason: string,
  ) {
    const row = await this.database.client.homeRowConfig.findUnique({ where: { id: rowId } });
    if (!row) throw adminBadRequest("HOME_ROW_NOT_FOUND", "Home row was not found.");
    if (row.source !== "EDITOR_PICKS") {
      throw adminBadRequest(
        "MANUAL_ITEMS_NOT_ALLOWED",
        "Manual items are only supported for Editor Picks rows.",
      );
    }
    const unique = new Set(items.map((item) => `${item.entityType}:${item.entityId}`));
    if (unique.size !== items.length)
      throw adminBadRequest("DUPLICATE_MANUAL_ITEM", "Manual items contain duplicates.");
    await this.assertEntitiesExist(items);

    return this.database.client.$transaction(async (tx) => {
      await tx.homeRowManualItem.deleteMany({ where: { rowId } });
      if (items.length > 0) {
        await tx.homeRowManualItem.createMany({
          data: items.map((item, position) => ({ rowId, position, ...item })),
        });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "HOME_ROW_MANUAL_ITEMS_REPLACED",
        entityType: "HomeRowConfig",
        entityId: rowId,
        reason,
        metadata: { itemCount: items.length },
      });
      return tx.homeRowConfig.findUniqueOrThrow({
        where: { id: rowId },
        include: { manualItems: { orderBy: { position: "asc" } } },
      });
    });
  }

  async updateControls(actorAccountId: string, input: UpdateProductControls) {
    const { reason, ...controls } = input;
    const value = productControlsSchema.parse(controls) as unknown as Prisma.InputJsonValue;
    return this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { namespace_key: { namespace: "DISCOVERY", key: PRODUCT_CONTROLS_KEY } },
        update: { value, valueType: "JSON", schemaVersion: 1 },
        create: {
          namespace: "DISCOVERY",
          key: PRODUCT_CONTROLS_KEY,
          valueType: "JSON",
          value,
          schemaVersion: 1,
          description:
            "Typed public merchandising, navigation, taxonomy and announcement controls.",
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "PRODUCT_CONTROLS_UPDATED",
        entityType: "PlatformSetting",
        entityId: `DISCOVERY:${PRODUCT_CONTROLS_KEY}`,
        reason,
        metadata: {
          navigationCount: controls.navigation.length,
          taxonomyCount: controls.taxonomy.length,
          announcementEnabled: controls.announcement.enabled,
        },
      });
      return controls;
    });
  }

  private async resolveHero(controls: ProductControls, context: VideoPolicyContext) {
    const { entityType, entityId } = controls.hero;
    if (!entityType || !entityId) return null;
    // Kids discovery only advertises individually classified videos. Container
    // pages and Creator TV do not promise the same Kids-only destination.
    if (context.isKidsProfile && entityType !== "VIDEO") return null;

    if (entityType === "VIDEO") {
      const [video] = await this.database.client.$queryRaw<
        Array<{ slug: string; title: string; description: string | null }>
      >(Prisma.sql`
        SELECT v.slug, v.title, v.description FROM "Video" v
        WHERE v.id = ${entityId}::uuid AND ${publicVideoEligibility(context)}
        LIMIT 1
      `);
      return video
        ? {
            entityType,
            entityId,
            title: video.title,
            description: video.description,
            href: context.isKidsProfile
              ? kidsSafeHref(`/watch/${encodeURIComponent(video.slug)}`)
              : `/watch/${encodeURIComponent(video.slug)}`,
          }
        : null;
    }

    if (entityType === "CHANNEL") {
      const channel = await this.database.client.channel.findFirst({
        where: { id: entityId, status: "ACTIVE", removedAt: null },
        select: { handle: true, name: true, description: true },
      });
      return channel
        ? {
            entityType,
            entityId,
            title: channel.name,
            description: channel.description,
            href: `/c/${encodeURIComponent(channel.handle)}`,
          }
        : null;
    }

    if (entityType === "CREATOR_TV") {
      const tv = await this.database.client.creatorTvChannel.findFirst({
        where: {
          id: entityId,
          status: "ACTIVE",
          disabledAt: null,
          channel: { status: "ACTIVE", removedAt: null, primaryTvChannelId: entityId },
        },
        select: { name: true, channel: { select: { handle: true } } },
      });
      return tv
        ? {
            entityType,
            entityId,
            title: tv.name,
            description: null,
            href: `/c/${encodeURIComponent(tv.channel.handle)}/tv`,
          }
        : null;
    }

    const playlist = await this.database.client.playlist.findFirst({
      where: {
        id: entityId,
        deletedAt: null,
        visibility: "PUBLIC",
        channel: { status: "ACTIVE", removedAt: null },
      },
      select: { slug: true, name: true, description: true, channel: { select: { handle: true } } },
    });
    return playlist
      ? {
          entityType,
          entityId,
          title: playlist.name,
          description: playlist.description,
          href: `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
        }
      : null;
  }

  private async assertEntitiesExist(
    items: Array<{ entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST"; entityId: string }>,
  ) {
    const groups = new Map<string, string[]>();
    for (const item of items)
      groups.set(item.entityType, [...(groups.get(item.entityType) ?? []), item.entityId]);
    const checks = await Promise.all([
      this.countExisting("VIDEO", groups.get("VIDEO") ?? []),
      this.countExisting("CREATOR_TV", groups.get("CREATOR_TV") ?? []),
      this.countExisting("CHANNEL", groups.get("CHANNEL") ?? []),
      this.countExisting("PLAYLIST", groups.get("PLAYLIST") ?? []),
    ]);
    const expected = ["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"].map(
      (type) => groups.get(type)?.length ?? 0,
    );
    if (checks.some((count, index) => count !== expected[index])) {
      throw adminBadRequest(
        "INVALID_MANUAL_ITEM",
        "One or more manual merchandising entities do not exist.",
      );
    }
  }

  private async countExisting(type: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    if (type === "VIDEO") return this.database.client.video.count({ where: { id: { in: ids } } });
    if (type === "CREATOR_TV")
      return this.database.client.creatorTvChannel.count({ where: { id: { in: ids } } });
    if (type === "CHANNEL")
      return this.database.client.channel.count({ where: { id: { in: ids } } });
    return this.database.client.playlist.count({ where: { id: { in: ids } } });
  }
}
