import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AdminGuard, RequireAdminRoles, RequireAdminStepUp } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { PayoutProviderTransferService } from "./payout-provider-transfer.service.js";

@Controller("admin/revenue/payout-provider")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminPayoutProviderController {
  constructor(
    @Inject(PayoutProviderTransferService)
    private readonly transfers: PayoutProviderTransferService,
  ) {}

  @Get("capabilities")
  capabilities() {
    return this.transfers.capabilities();
  }

  @Post("destinations/:profileId/verify")
  @RequireAdminStepUp()
  verifyDestination(
    @Req() request: AuthenticatedRequest,
    @Param("profileId") profileId: string,
    @Body() body: unknown,
  ) {
    return this.transfers.verifyDestination(request.ayinAuth.accountId, profileId, body);
  }
}

@Controller("admin/revenue/payouts")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminPayoutProviderTransferController {
  constructor(
    @Inject(PayoutProviderTransferService)
    private readonly transfers: PayoutProviderTransferService,
  ) {}

  @Get(":payoutId/provider")
  provider(@Param("payoutId") payoutId: string) {
    return this.transfers.getTransfer(payoutId);
  }

  @Post(":payoutId/provider/submit")
  @RequireAdminStepUp()
  submit(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    return this.transfers.submit(request.ayinAuth.accountId, payoutId, body);
  }

  @Post(":payoutId/provider/status")
  @RequireAdminStepUp()
  refresh(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    return this.transfers.refresh(request.ayinAuth.accountId, payoutId, body);
  }

  @Post(":payoutId/provider/cancel")
  @RequireAdminStepUp()
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId") payoutId: string,
    @Body() body: unknown,
  ) {
    return this.transfers.cancel(request.ayinAuth.accountId, payoutId, body);
  }
}

@Controller("payout-provider")
export class PayoutProviderWebhookController {
  constructor(
    @Inject(PayoutProviderTransferService)
    private readonly transfers: PayoutProviderTransferService,
  ) {}

  @Post("webhook")
  @Header("Cache-Control", "no-store")
  webhook(
    @Req()
    request: {
      rawBody?: Buffer;
      headers: Readonly<Record<string, string | string[] | undefined>>;
    },
  ) {
    if (!request.rawBody) throw new Error("PAYOUT_PROVIDER_WEBHOOK_RAW_BODY_REQUIRED");
    return this.transfers.processWebhook(request.headers, request.rawBody);
  }
}
