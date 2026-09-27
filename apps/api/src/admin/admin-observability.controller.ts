import { Controller, Get, Header, Inject, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { ObservabilityService } from "../observability/observability.service.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";

@Controller("admin/observability")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS", "SUPERADMIN")
export class AdminObservabilityController {
  constructor(
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  snapshot() {
    return this.observability.metricsSnapshot();
  }

  @Get("postgres")
  @Header("Cache-Control", "private, no-store")
  postgres() {
    return this.database.postgresPerformanceSnapshot();
  }
}
