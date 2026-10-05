import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import {
  homeRowPatchSchema,
  manualItemsSchema,
  reorderHomeRowsSchema,
  updateProductControlsSchema,
} from "./admin-product-config.js";
import { AdminProductService } from "./admin-product.service.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";

const uuidSchema = z.string().uuid();

@Controller("admin/product-controls")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminProductController {
  constructor(@Inject(AdminProductService) private readonly product: AdminProductService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  getSnapshot() {
    return this.product.getAdminSnapshot();
  }

  @Patch("home-rows/:rowId")
  @Header("Cache-Control", "private, no-store")
  @RequireAdminStepUp()
  patchRow(
    @Req() request: AdminAuthenticatedRequest,
    @Param("rowId") rowIdRaw: string,
    @Body() body: unknown,
  ) {
    const rowId = this.uuid(rowIdRaw);
    const input = this.parse(
      homeRowPatchSchema,
      body,
      "INVALID_HOME_ROW",
      "Check the home row settings.",
    );
    return this.product.patchRow(request.ayinAuth.accountId, rowId, input);
  }

  @Put("home-rows/order")
  @Header("Cache-Control", "private, no-store")
  @RequireAdminStepUp()
  reorderRows(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const input = this.parse(
      reorderHomeRowsSchema,
      body,
      "INVALID_HOME_ROW_ORDER",
      "Check the home row order.",
    );
    return this.product.reorderRows(request.ayinAuth.accountId, input.rowIds, input.reason);
  }

  @Put("home-rows/:rowId/manual-items")
  @Header("Cache-Control", "private, no-store")
  @RequireAdminStepUp()
  replaceManualItems(
    @Req() request: AdminAuthenticatedRequest,
    @Param("rowId") rowIdRaw: string,
    @Body() body: unknown,
  ) {
    const rowId = this.uuid(rowIdRaw);
    const input = this.parse(
      manualItemsSchema,
      body,
      "INVALID_MANUAL_ITEMS",
      "Check the manual merchandising items.",
    );
    return this.product.replaceManualItems(
      request.ayinAuth.accountId,
      rowId,
      input.items,
      input.reason,
    );
  }

  @Put("global")
  @Header("Cache-Control", "private, no-store")
  @RequireAdminStepUp()
  updateControls(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const input = this.parse(
      updateProductControlsSchema,
      body,
      "INVALID_PRODUCT_CONTROLS",
      "Check the product controls.",
    );
    return this.product.updateControls(request.ayinAuth.accountId, input);
  }

  private uuid(value: string): string {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) throw adminBadRequest("INVALID_ID", "Invalid resource ID.");
    return parsed.data;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown, code: string, message: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw adminBadRequest(code, message);
    return parsed.data;
  }
}

@Controller("product-controls")
@UseGuards(OptionalAuthGuard)
export class PublicProductController {
  constructor(
    @Inject(AdminProductService) private readonly product: AdminProductService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  getPublicControls(
    @Req() request: { ayinAuth?: AuthenticatedRequest["ayinAuth"] },
    @Headers() headers: HeaderBag,
    @Query("kids") kids: string | undefined,
  ) {
    return this.product.getPublicSnapshot({
      countryCode: this.trustedRegion.countryFromHeaders(headers),
      isKidsProfile: kids === "1",
      accountId: request.ayinAuth?.accountId,
    });
  }
}
