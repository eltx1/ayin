import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { StructuredLoggerService } from "./observability/structured-logger.service.js";
import { WarehouseExportWorkerService } from "./warehouse/warehouse-export-worker.service.js";

const application = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
const logger = application.get(StructuredLoggerService);
application.useLogger(logger);
application.flushLogs();

const worker = application.get(WarehouseExportWorkerService);
let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  logger.event("info", "warehouse_export_worker.shutdown_requested", { signal });
  worker.stop();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await worker.run();
} catch (error) {
  logger.event("error", "warehouse_export_worker.fatal", {
    errorName: error instanceof Error ? error.name : typeof error,
  });
  worker.stop();
  process.exitCode = 1;
} finally {
  worker.stop();
  await application.close();
}
