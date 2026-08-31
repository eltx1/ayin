import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { assignableAdminRoles, type AdminRole } from "./admin.roles.js";

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
export type SupportTicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type SupportTicketCategory =
  | "GENERAL"
  | "ACCOUNT"
  | "CONTENT"
  | "MONETIZATION"
  | "ADVERTISING"
  | "TECHNICAL"
  | "RIGHTS"
  | "OTHER";

interface SupportTicketRow {
  id: string;
  createdByAccountId: string;
  assignedToAccountId: string | null;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const candidate = text.trimStart();
  const numericLiteral = /^-?\d+(?:\.\d+)?$/.test(candidate);
  const formulaLeading =
    /^[\t\r\n]/.test(text) ||
    /^[=+@]/.test(candidate) ||
    (candidate.startsWith("-") && !numericLiteral);
  const safeText = formulaLeading ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join(
    "\n",
  );
}

@Injectable()
export class AdminGovernanceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  roles() {
    return { roles: assignableAdminRoles };
  }

  async staff(query?: string) {
    const assignments = await this.database.client.adminRoleAssignment.findMany({
      orderBy: [{ createdAt: "asc" }, { role: "asc" }],
    });
    const accountIds = [...new Set(assignments.map((item) => item.accountId))];
    if (!accountIds.length) return { items: [] };
    const q = query?.trim();
    const accounts = await this.database.client.account.findMany({
      where: {
        id: { in: accountIds },
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { displayName: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        authVersion: true,
        createdAt: true,
      },
      orderBy: { displayName: "asc" },
    });
    const byAccount = new Map<string, AdminRole[]>();
    for (const assignment of assignments) {
      if (!assignableAdminRoles.includes(assignment.role as AdminRole)) continue;
      const current = byAccount.get(assignment.accountId) ?? [];
      current.push(assignment.role as AdminRole);
      byAccount.set(assignment.accountId, current);
    }
    return {
      items: accounts.map((account) => ({ ...account, roles: byAccount.get(account.id) ?? [] })),
    };
  }

  async setStaffRoles(
    actorAccountId: string,
    accountId: string,
    roles: AdminRole[],
    reason: string,
  ) {
    const nextRoles = [...new Set(roles)];
    if (accountId === actorAccountId && !nextRoles.includes("SUPERADMIN")) {
      throw adminBadRequest(
        "SELF_SUPERADMIN_REMOVAL_BLOCKED",
        "A superadmin cannot remove their own superadmin access.",
      );
    }
    await this.database.client.account.findUniqueOrThrow({ where: { id: accountId } });
    return this.database.client.$transaction(async (tx) => {
      // Serialize staff-role mutations so concurrent cross-account demotions cannot remove every
      // superadmin. The transaction-scoped advisory lock is automatically released on commit/rollback.
      await tx.$executeRawUnsafe(
        "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034002); END $$;",
      );

      // AdminGuard ran before the transaction. Revalidate after acquiring the lock so a queued
      // request from a superadmin who was just demoted cannot commit another role mutation.
      const actorStillSuperadmin = await tx.adminRoleAssignment.findFirst({
        where: { accountId: actorAccountId, role: "SUPERADMIN" },
        select: { accountId: true },
      });
      if (!actorStillSuperadmin) {
        throw adminBadRequest(
          "SUPERADMIN_ACCESS_CHANGED",
          "Superadmin access changed before the staff-role update could be committed.",
        );
      }

      const before = await tx.adminRoleAssignment.findMany({
        where: { accountId },
        select: { role: true },
      });
      await tx.adminRoleAssignment.deleteMany({ where: { accountId } });
      if (nextRoles.length) {
        await tx.adminRoleAssignment.createMany({
          data: nextRoles.map((role) => ({ accountId, role })),
          skipDuplicates: true,
        });
      }

      const remainingSuperadmins = await tx.adminRoleAssignment.count({
        where: { role: "SUPERADMIN" },
      });
      if (remainingSuperadmins < 1) {
        throw adminBadRequest(
          "LAST_SUPERADMIN_REMOVAL_BLOCKED",
          "At least one superadmin must remain assigned.",
        );
      }

      await tx.account.update({
        where: { id: accountId },
        data: { authVersion: { increment: 1 } },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "staff.roles_updated",
        entityType: "Account",
        entityId: accountId,
        reason,
        metadata: {
          before: before.map((item) => item.role),
          after: nextRoles,
          sessionsRevoked: true,
        },
      });
      return { accountId, roles: nextRoles, sessionsRevoked: true };
    });
  }

  async auditLog(input: {
    page?: number;
    take?: number;
    query?: string;
    action?: string;
    entityType?: string;
  }) {
    const page = Math.max(1, input.page ?? 1);
    const take = Math.max(1, Math.min(100, input.take ?? 50));
    const query = input.query?.trim();
    const where = {
      ...(input.action ? { action: { contains: input.action, mode: "insensitive" as const } } : {}),
      ...(input.entityType
        ? { entityType: { contains: input.entityType, mode: "insensitive" as const } }
        : {}),
      ...(query
        ? {
            OR: [
              { action: { contains: query, mode: "insensitive" as const } },
              { entityType: { contains: query, mode: "insensitive" as const } },
              { entityId: { contains: query, mode: "insensitive" as const } },
              { reason: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.adminAuditLog.count({ where }),
      this.database.client.adminAuditLog.findMany({
        where,
        skip: (page - 1) * take,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const actors = await this.database.client.account.findMany({
      where: {
        id: { in: items.flatMap((item) => (item.actorAccountId ? [item.actorAccountId] : [])) },
      },
      select: { id: true, email: true, displayName: true },
    });
    const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
    return {
      items: items.map((item) => ({
        ...item,
        actor: item.actorAccountId ? (actorMap.get(item.actorAccountId) ?? null) : null,
      })),
      pagination: { total, page, take, pages: Math.max(1, Math.ceil(total / take)) },
    };
  }

  async revokeSessions(actorAccountId: string, accountId: string, reason: string) {
    return this.database.client.$transaction(async (tx) => {
      const account = await tx.account.update({
        where: { id: accountId },
        data: { authVersion: { increment: 1 } },
        select: { id: true, email: true, displayName: true, authVersion: true },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "account.sessions_revoked",
        entityType: "Account",
        entityId: accountId,
        reason,
        metadata: { authVersion: account.authVersion },
      });
      return { ...account, sessionsRevoked: true };
    });
  }

  async creatorCompliance(channelId: string) {
    const channel = await this.database.client.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { id: true, name: true, handle: true },
    });
    const profile = await this.database.client.creatorPayoutProfile.findUnique({
      where: { channelId },
      select: {
        id: true,
        legalName: true,
        preferredCurrency: true,
        provider: true,
        destinationMask: true,
        countryCode: true,
        identityStatus: true,
        taxStatus: true,
        updatedAt: true,
      },
    });
    return { channel, profile };
  }

  async updateCreatorCompliance(
    actorAccountId: string,
    channelId: string,
    input: { identityStatus?: string; taxStatus?: string; reason: string },
  ) {
    await this.database.client.channel.findUniqueOrThrow({ where: { id: channelId } });
    const existing = await this.database.client.creatorPayoutProfile.findUnique({
      where: { channelId },
    });
    if (!existing) {
      throw adminBadRequest(
        "PAYOUT_PROFILE_NOT_FOUND",
        "The creator must create a payout profile before compliance status can be updated.",
      );
    }
    return this.database.client.$transaction(async (tx) => {
      const profile = await tx.creatorPayoutProfile.update({
        where: { channelId },
        data: {
          ...(input.identityStatus ? { identityStatus: input.identityStatus } : {}),
          ...(input.taxStatus ? { taxStatus: input.taxStatus } : {}),
        },
        select: {
          id: true,
          channelId: true,
          identityStatus: true,
          taxStatus: true,
          updatedAt: true,
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "creator.compliance_updated",
        entityType: "CreatorPayoutProfile",
        entityId: profile.id,
        reason: input.reason,
        metadata: {
          channelId,
          identityStatus: profile.identityStatus,
          taxStatus: profile.taxStatus,
        },
      });
      return profile;
    });
  }

  async createSupportTicket(
    accountId: string,
    input: {
      category: SupportTicketCategory;
      subject: string;
      description: string;
      priority?: SupportTicketPriority;
    },
  ) {
    return this.database.client.supportTicket.create({
      data: {
        createdByAccountId: accountId,
        category: input.category,
        subject: input.subject,
        description: input.description,
        priority: input.priority ?? "NORMAL",
      },
    });
  }

  async mySupportTickets(accountId: string) {
    return {
      items: await this.database.client.supportTicket.findMany({
        where: { createdByAccountId: accountId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
    };
  }

  async supportTickets(input: { status?: SupportTicketStatus; priority?: SupportTicketPriority }) {
    const items = await this.database.client.$queryRaw<SupportTicketRow[]>`
      SELECT *
      FROM "SupportTicket"
      WHERE (${input.status ?? null}::text IS NULL OR "status" = ${input.status ?? null})
        AND (${input.priority ?? null}::text IS NULL OR "priority" = ${input.priority ?? null})
      ORDER BY
        CASE "priority"
          WHEN 'URGENT' THEN 4
          WHEN 'HIGH' THEN 3
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 1
          ELSE 0
        END DESC,
        "updatedAt" DESC,
        "id" DESC
      LIMIT 200
    `;
    const accountIds = [
      ...new Set(
        items.flatMap((item) =>
          [item.createdByAccountId, item.assignedToAccountId].filter(Boolean),
        ),
      ),
    ] as string[];
    const accounts = await this.database.client.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, email: true, displayName: true },
    });
    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    return {
      items: items.map((item) => ({
        ...item,
        createdBy: accountMap.get(item.createdByAccountId) ?? null,
        assignedTo: item.assignedToAccountId
          ? (accountMap.get(item.assignedToAccountId) ?? null)
          : null,
      })),
    };
  }

  async updateSupportTicket(
    actorAccountId: string,
    ticketId: string,
    input: {
      status?: SupportTicketStatus;
      priority?: SupportTicketPriority;
      assignedToAccountId?: string | null;
      resolution?: string | null;
      reason: string;
    },
  ) {
    if (input.assignedToAccountId) {
      const roles = await this.database.client.adminRoleAssignment.count({
        where: { accountId: input.assignedToAccountId },
      });
      if (!roles) throw adminBadRequest("ASSIGNEE_NOT_STAFF", "Ticket assignee must be staff.");
    }
    return this.database.client.$transaction(async (tx) => {
      const current = await tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
      const status = input.status ?? current.status;
      const ticket = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.assignedToAccountId !== undefined
            ? { assignedToAccountId: input.assignedToAccountId }
            : {}),
          ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
          closedAt:
            status === "CLOSED" || status === "RESOLVED" ? (current.closedAt ?? new Date()) : null,
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "support.ticket_updated",
        entityType: "SupportTicket",
        entityId: ticketId,
        reason: input.reason,
        metadata: {
          fromStatus: current.status,
          toStatus: ticket.status,
          priority: ticket.priority,
          assignedToAccountId: ticket.assignedToAccountId,
        },
      });
      return ticket;
    });
  }

  async exportCsv(resource: "users" | "channels" | "videos" | "payouts" | "audit") {
    const generatedAt = new Date().toISOString();
    if (resource === "users") {
      const rows = await this.database.client.account.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, displayName: true, status: true, createdAt: true },
      });
      return {
        filename: `ayin-users-${generatedAt.slice(0, 10)}.csv`,
        content: toCsv(
          ["id", "email", "displayName", "status", "createdAt"],
          rows.map((item) => [item.id, item.email, item.displayName, item.status, item.createdAt]),
        ),
      };
    }
    if (resource === "channels") {
      const rows = await this.database.client.channel.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          handle: true,
          name: true,
          status: true,
          isPlatformOwned: true,
          createdAt: true,
        },
      });
      return {
        filename: `ayin-channels-${generatedAt.slice(0, 10)}.csv`,
        content: toCsv(
          ["id", "handle", "name", "status", "isPlatformOwned", "createdAt"],
          rows.map((item) => [
            item.id,
            item.handle,
            item.name,
            item.status,
            item.isPlatformOwned,
            item.createdAt,
          ]),
        ),
      };
    }
    if (resource === "videos") {
      const rows = await this.database.client.video.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          channelId: true,
          slug: true,
          title: true,
          status: true,
          visibility: true,
          createdAt: true,
        },
      });
      return {
        filename: `ayin-videos-${generatedAt.slice(0, 10)}.csv`,
        content: toCsv(
          ["id", "channelId", "slug", "title", "status", "visibility", "createdAt"],
          rows.map((item) => [
            item.id,
            item.channelId,
            item.slug,
            item.title,
            item.status,
            item.visibility,
            item.createdAt,
          ]),
        ),
      };
    }
    if (resource === "payouts") {
      const rows = await this.database.client.payout.findMany({
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          channelId: true,
          status: true,
          amount: true,
          currency: true,
          externalReference: true,
          requestedAt: true,
          paidAt: true,
        },
      });
      return {
        filename: `ayin-payouts-${generatedAt.slice(0, 10)}.csv`,
        content: toCsv(
          [
            "id",
            "channelId",
            "status",
            "amount",
            "currency",
            "externalReference",
            "requestedAt",
            "paidAt",
          ],
          rows.map((item) => [
            item.id,
            item.channelId,
            item.status,
            item.amount,
            item.currency,
            item.externalReference,
            item.requestedAt,
            item.paidAt,
          ]),
        ),
      };
    }
    const rows = await this.database.client.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10_000,
      select: {
        id: true,
        actorAccountId: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        createdAt: true,
      },
    });
    return {
      filename: `ayin-audit-${generatedAt.slice(0, 10)}.csv`,
      content: toCsv(
        ["id", "actorAccountId", "action", "entityType", "entityId", "reason", "createdAt"],
        rows.map((item) => [
          item.id,
          item.actorAccountId,
          item.action,
          item.entityType,
          item.entityId,
          item.reason,
          item.createdAt,
        ]),
      ),
    };
  }
}
