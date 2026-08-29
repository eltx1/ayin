import { Body, Controller, Get, Inject, Param, Patch, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import {
  homeRowPatchSchema,
  manualItemsSchema,
  reorderHomeRowsSchema,
  updateProductControlsSchema,
} from "./admin-product-config.js";
import { AdminProductService } from "./admin-product.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, type AdminAuthenticatedRequest } from "./admin.guard.js";

const uuidSchema = z.string().uuid();

@Controller("admin/product-controls")
@UseGuards(AuthGuard, AdminGuard)
export class AdminProductController {
  constructor(@Inject(AdminProductService) private readonly product: AdminProductService) {}

  @Get()
  getSnapshot() {
    return this.product.getAdminSnapshot();
  }

  @Patch("home-rows/:rowId")
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
export class PublicProductController {
  constructor(@Inject(AdminProductService) private readonly product: AdminProductService) {}

  @Get()
  getPublicControls() {
    return this.product.getPublicControls();
  }
}
