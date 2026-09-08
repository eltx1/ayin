import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { MediaProcessingWorkerService } from "./media/media-processing-worker.service.js";
import { StructuredLoggerService } from "./observability/structured-logger.service.js";
import { PrivacyLifecycleWorkerService } from "./privacy/privacy-lifecycle-worker.service.js";

const application = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
const logger = application.get(StructuredLoggerService);
application.useLogger(logger);
application.flushLogs();
const mediaWorker = application.get(MediaProcessingWorkerService);
const privacyWorker = application.get(PrivacyLifecycleWorkerService);
let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  logger.event("info", "media_worker.shutdown_requested", { signal });
  mediaWorker.stop();
  privacyWorker.stop();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

const workers = [mediaWorker.run(), privacyWorker.run()];
try {
  await Promise.all(workers);
} catch (error) {
  logger.event("error", "media_worker.fatal", {
    errorName: error instanceof Error ? error.name : typeof error,
  });
  mediaWorker.stop();
  privacyWorker.stop();
  await Promise.allSettled(workers);
  process.exitCode = 1;
} finally {
  mediaWorker.stop();
  privacyWorker.stop();
  await application.close();
}
