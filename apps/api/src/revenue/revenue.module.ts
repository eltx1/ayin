import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { CreatorFinanceRepository } from "./creator-finance.repository.js";
import { CreatorFinanceService } from "./creator-finance.service.js";
import { CreatorMonetizationAnalyticsService } from "./creator-monetization-analytics.service.js";
import { CreatorMonetizationNotificationService } from "./creator-monetization-notification.service.js";
import {
  ManualPayoutProviderAdapter,
  PAYOUT_PROVIDER_ADAPTER,
  type PayoutProviderAdapter,
} from "./payout-provider.adapter.js";
import { AdminRevenueController, CreatorRevenueController } from "./revenue.controller.js";
import { RevenueService } from "./revenue.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [CreatorRevenueController, AdminRevenueController],
  providers: [
    RevenueService,
    CreatorFinanceRepository,
    CreatorFinanceService,
    CreatorMonetizationAnalyticsService,
    CreatorMonetizationNotificationService,
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
