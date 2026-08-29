import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import {
  defaultProductControls,
  productControlsSchema,
  type HomeRowPatch,
  type ProductControls,
  type UpdateProductControls,
} from "./admin-product-config.js";
import { adminBadRequest } from "./admin.errors.js";

const PRODUCT_CONTROLS_KEY = "productControls";

@Injectable()
export class AdminProductService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async getAdminSnapshot() {
    const [rows, controls] = await Promise.all([
      this.database.client.homeRowConfig.findMany({
        orderBy: [{ position: "asc" }, { key: "asc" }],
        include: { manualItems: { orderBy: { position: "asc" } } },
      }),
      this.getPublicControls(),
    ]);

    return { rows, controls };
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

  async getPublicSnapshot() {
    const controls = await this.getPublicControls();
    return {
      ...controls,
      resolvedHero: await this.resolveHero(controls),
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

    const existing = await this.database.client.homeRowConfig.findUnique({ where: { id: rowId } });
    if (!existing) throw adminBadRequest("HOME_ROW_NOT_FOUND", "Home row was not found.");

    return this.database.client.$transaction(async (tx) => {
      const row = await tx.homeRowConfig.update({ where: { id: rowId }, data: patch });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "HOME_ROW_UPDATED",
        entityType: "HomeRowConfig",
        entityId: rowId,
        reason,
        metadata: { key: existing.key, fields: Object.keys(patch) },
      });
      return row;
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
      return { rowIds };
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

  private async resolveHero(controls: ProductControls) {
    const { entityType, entityId } = controls.hero;
    if (!entityType || !entityId) return null;

    if (entityType === "VIDEO") {
      const video = await this.database.client.video.findFirst({
        where: { id: entityId, status: "PUBLISHED", visibility: { in: ["PUBLIC", "UNLISTED"] } },
        select: { slug: true, title: true, description: true },
      });
      return video
        ? {
            entityType,
            entityId,
            title: video.title,
            description: video.description ?? "Featured on AYIN.",
            href: `/watch/${video.slug}`,
          }
        : null;
    }

    if (entityType === "CHANNEL") {
      const channel = await this.database.client.channel.findFirst({
        where: { id: entityId, status: "ACTIVE" },
        select: { handle: true, name: true, description: true },
      });
      return channel
        ? {
            entityType,
            entityId,
            title: channel.name,
            description: channel.description ?? "Featured creator on AYIN.",
            href: `/c/${channel.handle}`,
          }
        : null;
    }

    if (entityType === "CREATOR_TV") {
      const tv = await this.database.client.creatorTvChannel.findFirst({
        where: { id: entityId, status: "ACTIVE" },
        select: { slug: true, name: true },
      });
      return tv
        ? {
            entityType,
            entityId,
            title: tv.name,
            description: "Featured Creator TV on AYIN.",
            href: `/tv/${tv.slug}`,
          }
        : null;
    }

    const playlist = await this.database.client.playlist.findFirst({
      where: { id: entityId, deletedAt: null, visibility: "PUBLIC" },
      select: { slug: true, name: true, description: true },
    });
    return playlist
      ? {
          entityType,
          entityId,
          title: playlist.name,
          description: playlist.description ?? "Featured playlist on AYIN.",
          href: `/playlist/${playlist.slug}`,
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
