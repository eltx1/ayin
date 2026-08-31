import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { CreatorFinanceService } from "./creator-finance.service.js";
import { RevenueService } from "./revenue.service.js";

@Controller("creator/studio/revenue")
@UseGuards(AuthGuard)
export class CreatorRevenueController {
  constructor(@Inject(CreatorFinanceService) private readonly finance: CreatorFinanceService) {}

  @Get()
  async overview(@Req() request: AuthenticatedRequest) {
    const result = await this.finance.overview(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return result;
  }

  @Get("payment-profile")
  async paymentProfile(@Req() request: AuthenticatedRequest) {
    const result = await this.finance.getProfile(request.ayinAuth.accountId);
    if (result === null) return null;
    return result;
  }

  @Put("payment-profile")
  updatePaymentProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.updateProfile(request.ayinAuth.accountId, body);
  }

  @Post("payout-requests")
  requestPayout(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.requestPayout(request.ayinAuth.accountId, body);
  }

  @Get("disputes")
  async disputes(@Req() request: AuthenticatedRequest) {
    const result = await this.finance.listDisputes(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return { items: result };
  }

  @Post("disputes")
  createDispute(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.createDispute(request.ayinAuth.accountId, body);
  }
}

@Controller("admin/revenue")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminRevenueController {
  constructor(
    @Inject(RevenueService) private readonly revenue: RevenueService,
    @Inject(CreatorFinanceService) private readonly finance: CreatorFinanceService,
  ) {}

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

  @Get("finance-summary")
  financeSummary() {
    return this.finance.adminFinanceSummary();
  }

  @Get("disputes")
  disputes(@Query("status") status?: string) {
    return this.finance.adminDisputes(status);
  }

  @Patch("disputes/:disputeId")
  updateDispute(
    @Req() request: AuthenticatedRequest,
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
  ) {
    return this.finance.updateAdminDispute(request.ayinAuth.accountId, disputeId, body);
  }
}
