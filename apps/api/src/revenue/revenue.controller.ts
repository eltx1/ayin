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

import { AdminGuard } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { RevenueService } from "./revenue.service.js";

@Controller("creator/studio/revenue")
@UseGuards(AuthGuard)
export class CreatorRevenueController {
  constructor(@Inject(RevenueService) private readonly revenue: RevenueService) {}

  @Get()
  async overview(@Req() request: AuthenticatedRequest) {
    const result = await this.revenue.creatorRevenue(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return result;
  }
}

@Controller("admin/revenue")
@UseGuards(AuthGuard, AdminGuard)
export class AdminRevenueController {
  constructor(@Inject(RevenueService) private readonly revenue: RevenueService) {}

  @Get("settings")
  settings() {
    return this.revenue.getSettings();
  }

  @Patch("settings")
  updateSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.revenue.updateSettings(request.ayinAuth.accountId, body);
  }

  @Get("channels/:channelId/contracts")
  contracts(@Param("channelId") channelId: string) {
    return this.revenue.getChannelContracts(channelId);
  }

  @Post("channels/:channelId/contracts")
  createContract(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
  ) {
    return this.revenue.createChannelContract(request.ayinAuth.accountId, channelId, body);
  }

  @Post("imports")
  importRevenue(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.revenue.importRevenue(request.ayinAuth.accountId, body);
  }

  @Get("ledger")
  ledger(@Query() query: Record<string, string | undefined>) {
    return this.revenue.searchLedger(query);
  }

  @Post("adjustments")
  adjustment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.revenue.addAdjustment(request.ayinAuth.accountId, body);
  }

  @Get("payouts")
  payouts(
    @Query("channelId") channelId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("take") take?: string,
  ) {
    return this.revenue.listPayouts({
      ...(channelId ? { channelId } : {}),
      ...(status ? { status } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(take ? { take: Number(take) } : {}),
    });
  }

  @Post("payouts")
  createPayout(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.revenue.createPayout(request.ayinAuth.accountId, body);
  }

  @Patch("payouts/:payoutId")
  updatePayout(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    return this.revenue.updatePayoutStatus(request.ayinAuth.accountId, payoutId, body);
  }
}
