import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionToken } from "../auth/session-transport.js";
import { renderPageAdFrame } from "./page-ad-frame.js";
import { PageAdService, pageAdEventSchema } from "./page-ad.service.js";

const frameKeySchema = z.string().regex(/^[a-z0-9_]{2,120}$/u);

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

  /** Public: which slots serve right now and the space each reserves (no targeting data). */
  @Get("layout")
  @Header("Cache-Control", "public, max-age=60, s-maxage=60")
  layout() {
    return this.pageAds.getLayout();
  }

  /**
   * Serves an administrator's pasted ad tag as its own document on the API origin. The web page
   * embeds it in a sandboxed iframe without allow-same-origin, so ad scripts run in an opaque
   * origin: they cannot read AYIN cookies, storage or the surrounding page, and the web CSP stays
   * strict while third-party ad networks keep working inside the frame.
   */
  @Get("frame/:key")
  async frame(
    @Param("key") key: string,
    @Query("app") app: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const code = frameKeySchema.safeParse(key).success
      ? await this.pageAds.getFrameCode(key)
      : null;
    reply.removeHeader("x-frame-options");
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    reply.header("cross-origin-resource-policy", "cross-origin");
    reply.header(
      "content-security-policy",
      `frame-ancestors ${process.env.WEB_ORIGIN ?? "https://ayin.stream"}`,
    );
    if (!code) reply.status(404);
    return renderPageAdFrame(code, { app: app === "1" });
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
@RequireAdminRoles("AD_MANAGER")
export class AdminPageAdController {
  constructor(@Inject(PageAdService) private readonly pageAds: PageAdService) {}

  @Get("settings")
  getSettings() {
    return this.pageAds.getSettings();
  }

  @Patch("settings")
  @RequireAdminStepUp()
  async updateSettings(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    try {
      return await this.pageAds.updateSettings(request.ayinAuth, body);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      throw new HttpException(
        {
          error: { code: "INVALID_PAGE_AD_SETTINGS", message: "Check page advertising settings." },
        },
        400,
      );
    }
  }
}
