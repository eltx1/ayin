import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";
import { assignableAdminRoles, type AdminRole } from "./admin.roles.js";
import { CatalogAdminMediaService } from "./catalog-admin-media.service.js";

const directorySearchSchema = z.string().trim().min(2).max(200);
const catalogSearchSchema = z.string().trim().max(200).optional();

@Controller("admin/operations/directory")
@UseGuards(AuthGuard, AdminGuard)
export class AdminScopedDirectoryController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogAdminMediaService) private readonly catalogMedia: CatalogAdminMediaService,
  ) {}

  @Get("support-assignees")
  @RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER")
  async supportAssignees() {
    const assignments = await this.database.client.adminRoleAssignment.findMany({
      select: { accountId: true, role: true },
      orderBy: [{ accountId: "asc" }, { role: "asc" }],
    });
    const accountIds = [...new Set(assignments.map((item) => item.accountId))];
    if (!accountIds.length) return { items: [] };

    const accounts = await this.database.client.account.findMany({
      where: { id: { in: accountIds }, status: "ACTIVE" },
      select: { id: true, email: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    const rolesByAccount = new Map<string, AdminRole[]>();
    for (const assignment of assignments) {
      if (!assignableAdminRoles.includes(assignment.role as AdminRole)) continue;
      const current = rolesByAccount.get(assignment.accountId) ?? [];
      current.push(assignment.role as AdminRole);
      rolesByAccount.set(assignment.accountId, current);
    }

    return {
      items: accounts.map((account) => ({
        ...account,
        roles: rolesByAccount.get(account.id) ?? [],
      })),
    };
  }

  @Get("catalog-videos")
  @RequireAdminRoles("OPERATIONS")
  async catalogVideos(@Query("query") queryRaw?: string) {
    const query = this.parseCatalogQuery(queryRaw, "INVALID_CATALOG_VIDEO_SEARCH");
    return { items: await this.catalogMedia.searchPlayableVideos(query, 25) };
  }

  @Get("catalog-artwork")
  @RequireAdminRoles("OPERATIONS")
  async catalogArtwork(@Query("query") queryRaw?: string) {
    const query = this.parseCatalogQuery(queryRaw, "INVALID_CATALOG_ARTWORK_SEARCH");
    return { items: await this.catalogMedia.searchArtwork(query, 25) };
  }

  @Get("catalog-genres")
  @RequireAdminRoles("OPERATIONS")
  async catalogGenres(@Query("query") queryRaw?: string) {
    const query = this.parseCatalogQuery(queryRaw, "INVALID_CATALOG_GENRE_SEARCH");
    const [movieGenres, seriesGenres] = await Promise.all([
      this.database.client.movieGenre.findMany({
        where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
        orderBy: { name: "asc" },
        take: 30,
        select: { name: true },
      }),
      this.database.client.seriesGenre.findMany({
        where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
        orderBy: { name: "asc" },
        take: 30,
        select: { name: true },
      }),
    ]);
    return {
      items: [...new Set([...movieGenres, ...seriesGenres].map((item) => item.name))]
        .toSorted((a, b) => a.localeCompare(b))
        .slice(0, 40)
        .map((name) => ({ name })),
    };
  }

  @Get("compliance-channels")
  @RequireAdminRoles("FINANCE_MANAGER")
  async complianceChannels(@Query("query") queryRaw?: string) {
    const query = this.parseQuery(queryRaw, "INVALID_COMPLIANCE_SEARCH");
    const items = await this.database.client.channel.findMany({
      where: {
        status: { not: "REMOVED" },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { handle: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 25,
      select: {
        id: true,
        name: true,
        handle: true,
        status: true,
        payoutProfile: {
          select: {
            legalName: true,
            preferredCurrency: true,
            identityStatus: true,
            taxStatus: true,
          },
        },
      },
    });

    return { items };
  }

  @Get("revenue-channels")
  @RequireAdminRoles("FINANCE_MANAGER")
  async revenueChannels(@Query("query") queryRaw?: string) {
    const query = this.parseQuery(queryRaw, "INVALID_REVENUE_CHANNEL_SEARCH");
    const items = await this.database.client.channel.findMany({
      where: {
        status: { not: "REMOVED" },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { handle: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 25,
      select: {
        id: true,
        name: true,
        handle: true,
        status: true,
        payoutProfile: {
          select: {
            preferredCurrency: true,
            identityStatus: true,
            taxStatus: true,
          },
        },
      },
    });

    return { items };
  }

  @Get("advertising-targets")
  @RequireAdminRoles("AD_MANAGER")
  async advertisingTargets(@Query("query") queryRaw?: string) {
    const query = this.parseQuery(queryRaw, "INVALID_AD_TARGET_SEARCH");
    const [channels, videos] = await Promise.all([
      this.database.client.channel.findMany({
        where: {
          status: { not: "REMOVED" },
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { handle: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 12,
        select: { id: true, name: true, handle: true, status: true },
      }),
      this.database.client.video.findMany({
        where: {
          status: { not: "REMOVED" },
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
            { channel: { name: { contains: query, mode: "insensitive" } } },
            { channel: { handle: { contains: query, mode: "insensitive" } } },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 12,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          channel: { select: { id: true, name: true, handle: true } },
        },
      }),
    ]);
    return { channels, videos };
  }

  private parseQuery(raw: string | undefined, code: string) {
    const parsed = directorySearchSchema.safeParse(raw ?? "");
    if (!parsed.success) {
      throw adminBadRequest(code, "Enter at least two search characters.");
    }
    return parsed.data;
  }

  private parseCatalogQuery(raw: string | undefined, code: string) {
    const parsed = catalogSearchSchema.safeParse(raw?.trim() || undefined);
    if (!parsed.success) throw adminBadRequest(code, "Catalog search is invalid.");
    return parsed.data;
  }
}
