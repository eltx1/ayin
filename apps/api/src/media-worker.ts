import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { MediaProcessingWorkerService } from "./media/media-processing-worker.service.js";

const application = await NestFactory.createApplicationContext(AppModule, {
  logger: ["error", "warn", "log"],
});
const worker = application.get(MediaProcessingWorkerService);
let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  worker.stop();
  console.log(`AYIN media worker received ${signal}; stopping new claims.`);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await worker.run();
} finally {
  await application.close();
}
