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
import { CreatorMonetizationAnalyticsService } from "./creator-monetization-analytics.service.js";
import { CreatorMonetizationNotificationService } from "./creator-monetization-notification.service.js";
import { CreatorRevenueCurrencyViewService } from "./creator-revenue-currency-view.service.js";
import { RevenueService } from "./revenue.service.js";

@Controller("creator/studio/revenue")
@UseGuards(AuthGuard)
export class CreatorRevenueController {
  constructor(
    @Inject(CreatorFinanceService) private readonly finance: CreatorFinanceService,
    @Inject(CreatorMonetizationAnalyticsService)
    private readonly monetizationAnalytics: CreatorMonetizationAnalyticsService,
    @Inject(CreatorMonetizationNotificationService)
    private readonly notifications: CreatorMonetizationNotificationService,
    @Inject(CreatorRevenueCurrencyViewService)
    private readonly currencyView: CreatorRevenueCurrencyViewService,
  ) {}

  @Get()
  async overview(@Req() request: AuthenticatedRequest) {
    const result = await this.finance.overview(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return this.currencyView.normalize(result);
  }

  @Get("analytics")
  async analytics(@Req() request: AuthenticatedRequest) {
    const result = await this.monetizationAnalytics.analytics(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return result;
  }

  @Get("statement")
  async statement(@Req() request: AuthenticatedRequest) {
    const result = await this.monetizationAnalytics.statement(request.ayinAuth.accountId);
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
  async requestPayout(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const result = await this.finance.requestPayout(request.ayinAuth.accountId, body);
    await this.notifications
      .notifyChannel({
        channelId: result.payout.channelId,
        title: "Payout request received",
        body: `${result.payout.currency} ${result.payout.amount} is pending review through AYIN's current manual payout workflow.`,
        data: {
          event: "PAYOUT_REQUESTED",
          payoutId: result.payout.id,
          status: result.payout.status,
        },
      })
      .catch(() => undefined);
    return result;
  }

  @Get("disputes")
  async disputes(@Req() request: AuthenticatedRequest) {
    const result = await this.finance.listDisputes(request.ayinAuth.accountId);
    if (!result) throw new HttpException("Creator channel not found.", 404);
    return { items: result };
  }

  @Post("disputes")
  async createDispute(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const dispute = await this.finance.createDispute(request.ayinAuth.accountId, body);
    await this.notifications
      .notifyChannel({
        channelId: dispute.channelId,
        title: "Revenue dispute opened",
        body: "Your revenue dispute was recorded and is available for AYIN finance review.",
        data: {
          event: "REVENUE_DISPUTE_CREATED",
          disputeId: dispute.id,
          status: dispute.status,
        },
      })
      .catch(() => undefined);
    return dispute;
  }
}

@Controller("admin/revenue")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminRevenueController {
  constructor(
    @Inject(RevenueService) private readonly revenue: RevenueService,
    @Inject(CreatorFinanceService) private readonly finance: CreatorFinanceService,
    @Inject(CreatorMonetizationNotificationService)
    private readonly notifications: CreatorMonetizationNotificationService,
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
  async importRevenue(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const importedAfter = new Date();
    const result = await this.revenue.importRevenue(request.ayinAuth.accountId, body);
    await this.notifications
      .notifyFinalizedRevenueImport(body, importedAfter)
      .catch(() => undefined);
    return result;
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
  async createPayout(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const payout = await this.revenue.createPayout(request.ayinAuth.accountId, body);
    await this.notifications
      .notifyChannel({
        channelId: payout.channelId,
        title: "Payout created",
        body: `${payout.currency} ${payout.amount} has entered AYIN's payout workflow.`,
        data: { event: "PAYOUT_CREATED", payoutId: payout.id, status: payout.status },
      })
      .catch(() => undefined);
    return payout;
  }

  @Patch("payouts/:payoutId")
  async updatePayout(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    const payout = await this.revenue.updatePayoutStatus(
      request.ayinAuth.accountId,
      payoutId,
      body,
    );
    await this.notifications
      .notifyChannel({
        channelId: payout.channelId,
        title: `Payout ${payout.status.toLowerCase()}`,
        body: `${payout.currency} ${payout.amount} is now ${payout.status.toLowerCase()}.`,
        data: { event: "PAYOUT_STATUS_UPDATED", payoutId: payout.id, status: payout.status },
      })
      .catch(() => undefined);
    return payout;
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
  async updateDispute(
    @Req() request: AuthenticatedRequest,
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
  ) {
    const dispute = await this.finance.updateAdminDispute(
      request.ayinAuth.accountId,
      disputeId,
      body,
    );
    await this.notifications
      .notifyChannel({
        channelId: dispute.channelId,
        title: `Revenue dispute ${dispute.status.toLowerCase()}`,
        body: dispute.resolution
          ? `AYIN finance updated your dispute: ${dispute.resolution}`
          : `Your revenue dispute is now ${dispute.status.toLowerCase()}.`,
        data: {
          event: "REVENUE_DISPUTE_UPDATED",
          disputeId: dispute.id,
          status: dispute.status,
        },
      })
      .catch(() => undefined);
    return dispute;
  }
}
