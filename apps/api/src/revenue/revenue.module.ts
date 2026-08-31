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
  ManualPayoutProviderAdapter,
  PAYOUT_PROVIDER_ADAPTER,
  type PayoutProviderAdapter,
} from "./payout-provider.adapter.js";
import { AdminRevenueController, CreatorRevenueController } from "./revenue.controller.js";
import { RevenueService } from "./revenue.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [CreatorRevenueController, AdminRevenueController, AdminPayoutDestinationController],
  providers: [
    RevenueService,
    CreatorFinanceRepository,
    CreatorFinanceService,
    CreatorMonetizationAnalyticsService,
    CreatorMonetizationNotificationService,
    CreatorRevenueCurrencyViewService,
    AdminPayoutCreationService,
    AdminPayoutDestinationService,
    ManualPayoutProviderAdapter,
    {
      provide: PAYOUT_PROVIDER_ADAPTER,
      inject: [ManualPayoutProviderAdapter],
      useFactory: (adapter: ManualPayoutProviderAdapter): PayoutProviderAdapter => adapter,
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
