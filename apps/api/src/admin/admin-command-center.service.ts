import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_CONFIG } from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";

export type AdminSearchResultKind = "ACCOUNT" | "CHANNEL" | "VIDEO" | "PAYOUT";

export interface AdminSearchResult {
  kind: AdminSearchResultKind;
  id: string;
  label: string;
  detail: string;
  href: string;
}

@Injectable()
export class AdminCommandCenterService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly mediaConfig: MediaStorageConfig,
  ) {}

  async search(rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) return { query, items: [] as AdminSearchResult[] };

    const [accounts, channels, videos, payouts] = await Promise.all([
      this.database.client.account.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { displayName: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, email: true, displayName: true, status: true },
      }),
      this.database.client.channel.findMany({
        where: {
          status: { not: "REMOVED" },
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { handle: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, name: true, handle: true, status: true },
      }),
      this.database.client.video.findMany({
        where: {
          status: { not: "REMOVED" },
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          channel: { select: { name: true, handle: true } },
        },
      }),
      this.database.client.payout.findMany({
        where: {
          OR: [
            ...(this.isUuid(query) ? [{ id: query }] : []),
            { externalReference: { contains: query, mode: "insensitive" } },
            { channel: { name: { contains: query, mode: "insensitive" } } },
            { channel: { handle: { contains: query, mode: "insensitive" } } },
          ],
        },
        orderBy: { requestedAt: "desc" },
        take: 6,
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          externalReference: true,
          channel: { select: { name: true, handle: true } },
        },
      }),
    ]);

    const items: AdminSearchResult[] = [
      ...accounts.map((account) => ({
        kind: "ACCOUNT" as const,
        id: account.id,
        label: account.displayName,
        detail: `${account.email} · ${account.status}`,
        href: `/admin/users?query=${encodeURIComponent(account.email)}`,
      })),
      ...channels.map((channel) => ({
        kind: "CHANNEL" as const,
        id: channel.id,
        label: channel.name,
        detail: `@${channel.handle} · ${channel.status}`,
        href: `/admin/channels?query=${encodeURIComponent(channel.handle)}`,
      })),
      ...videos.map((video) => ({
        kind: "VIDEO" as const,
        id: video.id,
        label: video.title,
        detail: `${video.channel.name} · ${video.status}`,
        href: `/admin/videos?query=${encodeURIComponent(video.slug)}`,
      })),
      ...payouts.map((payout) => ({
        kind: "PAYOUT" as const,
        id: payout.id,
        label: `${payout.currency} ${String(payout.amount)}`,
        detail: `${payout.channel.name} · ${payout.status}${payout.externalReference ? ` · ${payout.externalReference}` : ""}`,
        href: `/admin/revenue?channel=${encodeURIComponent(payout.channel.handle)}`,
      })),
    ];

    return { query, items: items.slice(0, 20) };
  }

  async health() {
    const checkedAt = new Date();
    let databaseStatus: "OK" | "ERROR" = "OK";
    let databaseReason: string | null = null;
    try {
      await this.database.client.$queryRaw`SELECT 1`;
    } catch (error) {
      databaseStatus = "ERROR";
      databaseReason =
        error instanceof Error ? error.message : "Database connectivity check failed.";
    }

    const storageMode = this.mediaConfig.mode;
    const r2Configured = storageMode === "r2";
    const storageStatus =
      storageMode === "r2" ? "READY" : storageMode === "e2e" ? "TEST" : "DEVELOPMENT";

    return {
      checkedAt,
      api: { status: "OK" as const },
      database: { status: databaseStatus, reason: databaseReason },
      mediaStorage: {
        status: storageStatus,
        mode: storageMode,
        r2Configured,
        bucketConfigured: Boolean(this.mediaConfig.bucket),
        region: this.mediaConfig.region,
        directUploadArchitecture: true,
      },
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
