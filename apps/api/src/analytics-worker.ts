import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { AnalyticsRollupWorkerService } from "./analytics/analytics-rollup-worker.service.js";
import { StructuredLoggerService } from "./observability/structured-logger.service.js";

const application = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
const logger = application.get(StructuredLoggerService);
application.useLogger(logger);
application.flushLogs();

const worker = application.get(AnalyticsRollupWorkerService);
let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  logger.event("info", "analytics_rollup_worker.shutdown_requested", { signal });
  worker.stop();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await worker.run();
} catch (error) {
  logger.event("error", "analytics_rollup_worker.fatal", {
    errorName: error instanceof Error ? error.name : typeof error,
  });
  worker.stop();
  process.exitCode = 1;
} finally {
  worker.stop();
  await application.close();
}
