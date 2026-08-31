import type { HealthResponse } from "@ayin/types";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { DatabaseService } from "./database/database.service.js";

@Controller()
export class AppController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return {
      service: "ayin-api",
      status: "ok",
    };
  }

  @Get("ready")
  async getReadiness() {
    try {
      await this.database.client.$queryRaw`SELECT 1`;
      return {
        service: "ayin-api",
        status: "ready",
      } as const;
    } catch {
      throw new ServiceUnavailableException({
        service: "ayin-api",
        status: "not_ready",
      });
    }
  }
}
