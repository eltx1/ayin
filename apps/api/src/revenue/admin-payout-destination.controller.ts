import { Body, Controller, Get, Header, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { AdminPayoutDestinationService } from "./admin-payout-destination.service.js";

@Controller("admin/revenue/payouts")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminPayoutDestinationController {
  constructor(
    @Inject(AdminPayoutDestinationService)
    private readonly destinations: AdminPayoutDestinationService,
  ) {}

  @Get(":payoutId")
  @Header("Cache-Control", "no-store, private")
  details(@Param("payoutId") payoutId: string) {
    return this.destinations.details(payoutId);
  }

  @Post(":payoutId/destination")
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  reveal(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    return this.destinations.reveal(request.ayinAuth.accountId, payoutId, body);
  }
}
