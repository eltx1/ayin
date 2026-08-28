import { Controller, Get } from "@nestjs/common";

import type { HealthResponse } from "@ayin/types";

@Controller("health")
export class AppController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: "ayin-api",
      status: "ok",
    };
  }
}
