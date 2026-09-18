import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AdminPayoutCreationService } from "./admin-payout-creation.service.js";
import { AdminPayoutDestinationController } from "./admin-payout-destination.controller.js";
import { AdminPayoutDestinationService } from "./admin-payout-destination.service.js";
import { CreatorFinanceRepository } from "./creator-finance.repository.js";
import { CreatorFinanceService } from "./creator-finance.service.js";
import { CreatorMonetizationAnalyticsService } from "./creator-monetization-analytics.service.js";
import { CreatorMonetizationNotificationService } from "./creator-monetization-notification.service.js";
import { CreatorRevenueCurrencyViewService } from "./creator-revenue-currency-view.service.js";
import {
  DisabledExternalPayoutProviderAdapter,
  EXTERNAL_PAYOUT_PROVIDER_ADAPTER,
  type ExternalPayoutProviderAdapter,
} from "./external-payout-provider.adapter.js";
import {
  ManualPayoutProviderAdapter,
  PAYOUT_PROVIDER_ADAPTER,
  type PayoutProviderAdapter,
} from "./payout-provider.adapter.js";
import {
  AdminPayoutProviderController,
  AdminPayoutProviderTransferController,
  PayoutProviderWebhookController,
} from "./payout-provider.controller.js";
import { PayoutProviderTransferService } from "./payout-provider-transfer.service.js";
import { RevenueReconciliationController } from "./revenue-reconciliation.controller.js";
import { RevenueReconciliationService } from "./revenue-reconciliation.service.js";
import {
  ManualRevenueReportingAdapter,
  REVENUE_REPORTING_ADAPTER,
  type RevenueReportingAdapter,
} from "./revenue-reporting.adapter.js";
import { AdminRevenueController, CreatorRevenueController } from "./revenue.controller.js";
import { RevenueService } from "./revenue.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [
    CreatorRevenueController,
    AdminRevenueController,
    RevenueReconciliationController,
    AdminPayoutDestinationController,
    AdminPayoutProviderController,
    AdminPayoutProviderTransferController,
    PayoutProviderWebhookController,
  ],
  providers: [
    RevenueService,
    RevenueReconciliationService,
    CreatorFinanceRepository,
    CreatorFinanceService,
    CreatorMonetizationAnalyticsService,
    CreatorMonetizationNotificationService,
    CreatorRevenueCurrencyViewService,
    AdminPayoutCreationService,
    AdminPayoutDestinationService,
    PayoutProviderTransferService,
    ManualPayoutProviderAdapter,
    DisabledExternalPayoutProviderAdapter,
    ManualRevenueReportingAdapter,
    {
      provide: PAYOUT_PROVIDER_ADAPTER,
      inject: [ManualPayoutProviderAdapter],
      useFactory: (adapter: ManualPayoutProviderAdapter): PayoutProviderAdapter => adapter,
    },
    {
      provide: EXTERNAL_PAYOUT_PROVIDER_ADAPTER,
      inject: [DisabledExternalPayoutProviderAdapter],
      useFactory: (adapter: DisabledExternalPayoutProviderAdapter): ExternalPayoutProviderAdapter =>
        adapter,
    },
    {
      provide: REVENUE_REPORTING_ADAPTER,
      inject: [ManualRevenueReportingAdapter],
      useFactory: (adapter: ManualRevenueReportingAdapter): RevenueReportingAdapter => adapter,
    },
  ],
  exports: [
    RevenueService,
    CreatorFinanceService,
    CreatorMonetizationAnalyticsService,
    CreatorMonetizationNotificationService,
  ],
})
export class RevenueModule {}
