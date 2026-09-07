import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { ObservabilityExceptionFilter } from "./observability-exception.filter.js";
import { ObservabilityService } from "./observability.service.js";
import { StructuredLoggerService } from "./structured-logger.service.js";
import { LocalTelemetryAdapter, TELEMETRY_ADAPTER } from "./telemetry.adapter.js";

@Global()
@Module({
  imports: [DatabaseModule, PlatformConfigModule],
  providers: [
    StructuredLoggerService,
    { provide: TELEMETRY_ADAPTER, useClass: LocalTelemetryAdapter },
    ObservabilityService,
    { provide: APP_FILTER, useClass: ObservabilityExceptionFilter },
  ],
  exports: [StructuredLoggerService, ObservabilityService, TELEMETRY_ADAPTER],
})
export class ObservabilityModule {}
