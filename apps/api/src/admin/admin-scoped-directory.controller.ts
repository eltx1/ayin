import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";
import { assignableAdminRoles, type AdminRole } from "./admin.roles.js";

const directorySearchSchema = z.string().trim().min(2).max(200);

@Controller("admin/operations/directory")
@UseGuards(AuthGuard, AdminGuard)
export class AdminScopedDirectoryController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

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
}
