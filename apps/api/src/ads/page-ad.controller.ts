import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { AdminGuard } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionToken } from "../auth/session-transport.js";
import { PageAdService, pageAdEventSchema } from "./page-ad.service.js";

const decisionQuerySchema = z.object({
  route: z.string().trim().min(1).max(500),
  device: z.enum(["MOBILE", "DESKTOP", "TV"]),
  category: z.string().trim().min(1).max(120).nullable().optional(),
});

@Controller("ads/page")
export class PageAdController {
  constructor(
    @Inject(PageAdService) private readonly pageAds: PageAdService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get("decision/:key")
  async getDecision(
    @Param("key") key: string,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
  ) {
    const parsed = decisionQuerySchema.safeParse({
      route: query.route,
      device: query.device,
      category: query.category ?? null,
    });
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_PAGE_AD_CONTEXT", message: "Invalid page ad context." } },
        400,
      );
    }
    return this.pageAds.getDecision(key, {
      route: parsed.data.route,
      device: parsed.data.device,
      signedIn: await this.isSignedIn(request),
      category: parsed.data.category ?? null,
    });
  }

  @Post("events")
  async recordEvent(@Body() body: unknown) {
    const parsed = pageAdEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_PAGE_AD_EVENT", message: "Invalid page ad event." } },
        400,
      );
    }
    return this.pageAds.recordEvent(parsed.data);
  }

  private async isSignedIn(request: FastifyRequest) {
    const token = readSessionToken(request);
    if (!token) return false;
    try {
      await this.authService.authenticate(token);
      return true;
    } catch {
      return false;
    }
  }
}

@Controller("admin/page-ads")
@UseGuards(AuthGuard, AdminGuard)
export class AdminPageAdController {
  constructor(@Inject(PageAdService) private readonly pageAds: PageAdService) {}

  @Get("settings")
  getSettings() {
    return this.pageAds.getSettings();
  }

  @Patch("settings")
  async updateSettings(@Body() body: unknown) {
    try {
      return await this.pageAds.updateSettings(body);
    } catch {
      throw new HttpException(
        {
          error: { code: "INVALID_PAGE_AD_SETTINGS", message: "Check page advertising settings." },
        },
        400,
      );
    }
  }
}
