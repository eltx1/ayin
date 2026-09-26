import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import {
  DisabledWarehouseExportAdapter,
  WAREHOUSE_EXPORT_ADAPTER,
} from "./warehouse-export.adapter.js";
import { WarehouseExportService } from "./warehouse-export.service.js";
import { WarehouseExportWorkerService } from "./warehouse-export-worker.service.js";

@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [
    WarehouseExportService,
    WarehouseExportWorkerService,
    {
      provide: WAREHOUSE_EXPORT_ADAPTER,
      useFactory: () => new DisabledWarehouseExportAdapter(),
    },
  ],
  exports: [WarehouseExportService],
})
export class WarehouseModule {}
