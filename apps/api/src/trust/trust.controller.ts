import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { TrustService } from "./trust.service.js";
@Controller("trust")
@UseGuards(AuthGuard)
export class TrustController {
  constructor(@Inject(TrustService) private readonly trust: TrustService) {}
  @Post("reports") report(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.trust.report(r.ayinAuth.accountId, b);
  }
  @Post("takedowns") takedown(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.trust.takedown(r.ayinAuth.accountId, b);
  }
  @Post("appeals") appeal(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.trust.appeal(r.ayinAuth.accountId, b);
  }
  @Get("creator/history") history(@Req() r: AuthenticatedRequest) {
    return this.trust.creatorHistory(r.ayinAuth.accountId);
  }
}
@Controller("admin/trust")
@UseGuards(AuthGuard, AdminGuard)
export class AdminTrustController {
  constructor(@Inject(TrustService) private readonly trust: TrustService) {}
  @Get("queue") queue() {
    return this.trust.listQueue();
  }
  @Get("settings") settings() {
    return this.trust.settings();
  }
  @Put("settings") updateSettings(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.trust.updateSettings(r.ayinAuth.accountId, b);
  }
  @Post("actions") act(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    return this.trust.act(r.ayinAuth.accountId, b);
  }
  @Patch("cases/:id") updateCase(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.trust.updateCase(r.ayinAuth.accountId, id, b);
  }
  @Patch("appeals/:id") appeal(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.trust.decideAppeal(r.ayinAuth.accountId, id, b);
  }
  @Patch("takedowns/:id") takedown(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.trust.decideTakedown(r.ayinAuth.accountId, id, b);
  }
  @Put("channels/:id") setTrust(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.trust.setTrust(r.ayinAuth.accountId, id, b);
  }
}
