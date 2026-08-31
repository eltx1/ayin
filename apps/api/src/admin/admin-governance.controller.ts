import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGovernanceService } from "./admin-governance.service.js";
import { AdminGuard, type AdminAuthenticatedRequest, RequireAdminRoles } from "./admin.guard.js";
import { assignableAdminRoles } from "./admin.roles.js";

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(8).max(500);
const staffRolesSchema = z
  .object({
    roles: z
      .array(z.enum(assignableAdminRoles as [string, ...string[]]))
      .max(assignableAdminRoles.length),
    reason: reasonSchema,
  })
  .strict();
const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().trim().max(200).optional(),
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
});
const complianceSchema = z
  .object({
    identityStatus: z.enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"]).optional(),
    taxStatus: z.enum(["NOT_PROVIDED", "PENDING", "VALID", "REJECTED"]).optional(),
    reason: reasonSchema,
  })
  .strict()
  .refine((value) => Boolean(value.identityStatus || value.taxStatus), {
    message: "At least one compliance status is required.",
  });
const supportStatus = z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]);
const supportPriority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const supportCategory = z.enum([
  "GENERAL",
  "ACCOUNT",
  "CONTENT",
  "MONETIZATION",
  "ADVERTISING",
  "TECHNICAL",
  "RIGHTS",
  "OTHER",
]);
const supportCreateSchema = z
  .object({
    category: supportCategory,
    subject: z.string().trim().min(4).max(200),
    description: z.string().trim().min(10).max(20_000),
    priority: supportPriority.optional(),
  })
  .strict();
const supportUpdateSchema = z
  .object({
    status: supportStatus.optional(),
    priority: supportPriority.optional(),
    assignedToAccountId: z.string().uuid().nullable().optional(),
    resolution: z.string().trim().max(20_000).nullable().optional(),
    reason: reasonSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.priority !== undefined ||
      value.assignedToAccountId !== undefined ||
      value.resolution !== undefined,
    { message: "At least one ticket update is required." },
  );
const exportResourceSchema = z.enum(["users", "channels", "videos", "payouts", "audit"]);

@Controller("support/tickets")
@UseGuards(AuthGuard)
export class SupportTicketController {
  constructor(
    @Inject(AdminGovernanceService) private readonly governance: AdminGovernanceService,
  ) {}

  @Get()
  myTickets(@Req() request: AuthenticatedRequest) {
    return this.governance.mySupportTickets(request.ayinAuth.accountId);
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = supportCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_SUPPORT_TICKET",
        parsed.error.issues[0]?.message ?? "The support ticket is invalid.",
      );
    }
    return this.governance.createSupportTicket(request.ayinAuth.accountId, {
      category: parsed.data.category,
      subject: parsed.data.subject,
      description: parsed.data.description,
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
    });
  }
}

@Controller("admin/operations")
@UseGuards(AuthGuard, AdminGuard)
export class AdminGovernanceController {
  constructor(
    @Inject(AdminGovernanceService) private readonly governance: AdminGovernanceService,
  ) {}

  @Get("roles")
  @RequireAdminRoles("OPERATIONS")
  roles() {
    return this.governance.roles();
  }

  @Get("staff")
  @RequireAdminRoles("OPERATIONS")
  staff(@Query("query") query?: string) {
    return this.governance.staff(query);
  }

  @Patch("staff/:accountId/roles")
  @RequireAdminRoles("SUPERADMIN")
  setStaffRoles(
    @Req() request: AdminAuthenticatedRequest,
    @Param("accountId") accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const accountId = this.uuid(accountIdRaw);
    const parsed = staffRolesSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_STAFF_ROLES",
        parsed.error.issues[0]?.message ?? "The staff role update is invalid.",
      );
    }
    return this.governance.setStaffRoles(
      request.ayinAuth.accountId,
      accountId,
      parsed.data.roles as Parameters<AdminGovernanceService["setStaffRoles"]>[2],
      parsed.data.reason,
    );
  }

  @Get("audit")
  @RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR", "AD_MANAGER", "FINANCE_MANAGER")
  audit(@Query() query: unknown) {
    const parsed = auditQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw adminBadRequest("INVALID_AUDIT_FILTER", "The audit-log filter is invalid.");
    }
    return this.governance.auditLog({
      ...(parsed.data.page !== undefined ? { page: parsed.data.page } : {}),
      ...(parsed.data.take !== undefined ? { take: parsed.data.take } : {}),
      ...(parsed.data.query !== undefined ? { query: parsed.data.query } : {}),
      ...(parsed.data.action !== undefined ? { action: parsed.data.action } : {}),
      ...(parsed.data.entityType !== undefined ? { entityType: parsed.data.entityType } : {}),
    });
  }

  @Post("accounts/:accountId/revoke-sessions")
  @RequireAdminRoles("OPERATIONS")
  revokeSessions(
    @Req() request: AdminAuthenticatedRequest,
    @Param("accountId") accountIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = z.object({ reason: reasonSchema }).strict().safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest("INVALID_SESSION_REVOCATION", "A valid audit reason is required.");
    }
    return this.governance.revokeSessions(
      request.ayinAuth.accountId,
      this.uuid(accountIdRaw),
      parsed.data.reason,
    );
  }

  @Get("compliance/:channelId")
  @RequireAdminRoles("FINANCE_MANAGER")
  compliance(@Param("channelId") channelIdRaw: string) {
    return this.governance.creatorCompliance(this.uuid(channelIdRaw));
  }

  @Patch("compliance/:channelId")
  @RequireAdminRoles("FINANCE_MANAGER")
  updateCompliance(
    @Req() request: AdminAuthenticatedRequest,
    @Param("channelId") channelIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = complianceSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_CREATOR_COMPLIANCE_UPDATE",
        parsed.error.issues[0]?.message ?? "The creator compliance update is invalid.",
      );
    }
    return this.governance.updateCreatorCompliance(
      request.ayinAuth.accountId,
      this.uuid(channelIdRaw),
      {
        reason: parsed.data.reason,
        ...(parsed.data.identityStatus !== undefined
          ? { identityStatus: parsed.data.identityStatus }
          : {}),
        ...(parsed.data.taxStatus !== undefined ? { taxStatus: parsed.data.taxStatus } : {}),
      },
    );
  }

  @Get("support")
  @RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER")
  support(@Query("status") statusRaw?: string, @Query("priority") priorityRaw?: string) {
    const status = statusRaw ? supportStatus.safeParse(statusRaw) : null;
    const priority = priorityRaw ? supportPriority.safeParse(priorityRaw) : null;
    if (status && !status.success) {
      throw adminBadRequest("INVALID_SUPPORT_STATUS", "The support status filter is invalid.");
    }
    if (priority && !priority.success) {
      throw adminBadRequest("INVALID_SUPPORT_PRIORITY", "The support priority filter is invalid.");
    }
    return this.governance.supportTickets({
      ...(status?.success ? { status: status.data } : {}),
      ...(priority?.success ? { priority: priority.data } : {}),
    });
  }

  @Patch("support/:ticketId")
  @RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER")
  updateSupport(
    @Req() request: AdminAuthenticatedRequest,
    @Param("ticketId") ticketIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = supportUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_SUPPORT_TICKET_UPDATE",
        parsed.error.issues[0]?.message ?? "The support ticket update is invalid.",
      );
    }
    return this.governance.updateSupportTicket(request.ayinAuth.accountId, this.uuid(ticketIdRaw), {
      reason: parsed.data.reason,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.assignedToAccountId !== undefined
        ? { assignedToAccountId: parsed.data.assignedToAccountId }
        : {}),
      ...(parsed.data.resolution !== undefined ? { resolution: parsed.data.resolution } : {}),
    });
  }

  @Get("exports/:resource")
  @RequireAdminRoles("OPERATIONS", "FINANCE_MANAGER")
  export(@Param("resource") resourceRaw: string) {
    const parsed = exportResourceSchema.safeParse(resourceRaw);
    if (!parsed.success) {
      throw adminBadRequest("INVALID_EXPORT_RESOURCE", "The requested export is not available.");
    }
    return this.governance.exportCsv(parsed.data);
  }

  private uuid(raw: string) {
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success)
      throw adminBadRequest("INVALID_ID", "The requested resource id is invalid.");
    return parsed.data;
  }
}
