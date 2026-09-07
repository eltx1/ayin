import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { ObservabilityExceptionFilter } from "./observability-exception.filter.js";
import { ObservabilityService } from "./observability.service.js";
import { StructuredLoggerService } from "./structured-logger.service.js";

@Global()
@Module({
  imports: [DatabaseModule, PlatformConfigModule],
  providers: [
    StructuredLoggerService,
    ObservabilityService,
    { provide: APP_FILTER, useClass: ObservabilityExceptionFilter },
  ],
  exports: [StructuredLoggerService, ObservabilityService],
})
export class ObservabilityModule {}
