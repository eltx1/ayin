import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { RevenueReconciliationService } from "./revenue-reconciliation.service.js";

@Controller("admin/revenue/reconciliation")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class RevenueReconciliationController {
  constructor(
    @Inject(RevenueReconciliationService)
    private readonly reconciliation: RevenueReconciliationService,
  ) {}

  @Get("capabilities")
  capabilities() {
    return this.reconciliation.capabilities();
  }

  @Post("imports")
  importReport(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.reconciliation.importReport(request.ayinAuth.accountId, body);
  }

  @Get("reports")
  reports(@Query() query: Record<string, string | undefined>) {
    return this.reconciliation.listReports(query);
  }

  @Get("reports/:reportId")
  report(@Param("reportId") reportId: string) {
    return this.reconciliation.getReport(reportId);
  }
}
