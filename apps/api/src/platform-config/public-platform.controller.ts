import { Controller, Get, Inject } from "@nestjs/common";

import { FeatureFlagService } from "./feature-flag.service.js";

export const publicNavigationFeatureFlagKeys = [
  "navigation.movies",
  "navigation.series",
  "navigation.tv",
  "navigation.creators",
  "navigation.shorts",
  "navigation.kids",
  "navigation.my-ayin",
] as const;

@Controller("platform")
export class PublicPlatformController {
  constructor(@Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService) {}

  @Get("navigation")
  async navigation() {
    return {
      flags: await this.featureFlags.resolveEnabled(publicNavigationFeatureFlagKeys),
    };
  }
}
