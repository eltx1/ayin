import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

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
  @Header("Cache-Control", "private, no-store")
  capabilities() {
    return this.reconciliation.capabilities();
  }

  @Post("imports")
  importReport(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.reconciliation.importReport(request.ayinAuth.accountId, body);
  }

  @Get("reports")
  @Header("Cache-Control", "private, no-store")
  reports(@Query() query: Record<string, string | undefined>) {
    return this.reconciliation.listReports(query);
  }

  @Get("reports/:reportId")
  @Header("Cache-Control", "private, no-store")
  report(@Param("reportId") reportId: string) {
    return this.reconciliation.getReport(reportId);
  }

  @Get("lookup")
  @Header("Cache-Control", "private, no-store")
  lookup(@Query("source") source?: string, @Query("sourceReportId") sourceReportId?: string) {
    return this.reconciliation.lookupReport(source, sourceReportId);
  }
}
