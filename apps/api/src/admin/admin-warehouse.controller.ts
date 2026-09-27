import { Controller, Get, Header, Inject, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { WarehouseExportService } from "../warehouse/warehouse-export.service.js";
import { configuredWarehouseExportIntervalMs } from "../warehouse/warehouse-export-worker.service.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";

@Controller("admin/warehouse-status")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminWarehouseController {
  constructor(@Inject(WarehouseExportService) private readonly exports: WarehouseExportService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  async status() {
    return {
      ...(await this.exports.operatorStatus()),
      intervalMs: configuredWarehouseExportIntervalMs(),
    };
  }
}
