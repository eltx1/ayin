import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { ObservabilityService } from "./observability/observability.service.js";

@Controller()
export class AppController {
  constructor(@Inject(ObservabilityService) private readonly observability: ObservabilityService) {}

  @Get(["health", "health/live"])
  getHealth() {
    return this.observability.live();
  }

  @Get(["ready", "health/ready"])
  async getReadiness() {
    const readiness = await this.observability.ready();
    if (readiness.status !== "ready") {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
