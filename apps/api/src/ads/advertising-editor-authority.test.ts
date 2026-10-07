import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AdminAuthenticatedRequest } from "../admin/admin.guard.js";
import type { DatabaseService } from "../database/database.service.js";
import type { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { AdminAdvertisingControlController } from "./advertising-control.controller.js";
import type { AdvertisingControlService } from "./advertising-control.service.js";
import { AdminAuthorizedSellerFileController } from "./authorized-seller-file.controller.js";
import { AuthorizedSellerFileService } from "./authorized-seller-file.service.js";
import { AdminPageAdController } from "./page-ad.controller.js";
import type { PageAdService } from "./page-ad.service.js";
import type { GamProductionService } from "./gam-production.service.js";

const id = "00000000-0000-4000-8000-000000000001";
const request = {
  ayinAuth: {
    accountId: id,
    sessionId: "00000000-0000-4000-8000-000000000002",
    authVersion: 3,
    mfaVersion: 4,
    mfaAt: 123,
    reauthAt: 456,
  },
} as AdminAuthenticatedRequest;
const input = { name: "Reviewed editor input" };
const sellerInput = { text: "# Reviewed seller content", reason: "Reviewed seller file change" };
const commands = [
  "kill",
  "placement-create",
  "placement-update",
  "creative-create",
  "creative-update",
  "creative-delete",
  "seller",
  "page",
] as const;
type Command = (typeof commands)[number];

function fixture(command: Command) {
  const operation = vi.fn().mockResolvedValue({ saved: true });
  const advertising = new AdminAdvertisingControlController({
    setEmergencyKillSwitch: operation,
    createPlacement: operation,
    updatePlacement: operation,
    createCreative: operation,
    updateCreative: operation,
    deleteCreative: operation,
  } as unknown as AdvertisingControlService);
  const seller = new AdminAuthorizedSellerFileController({
    update: operation,
  } as unknown as AuthorizedSellerFileService);
  const page = new AdminPageAdController({ updateSettings: operation } as unknown as PageAdService);
  const calls = {
    kill: () => advertising.killSwitch(request, { enabled: false, reason: "Reviewed stop" }),
    "placement-create": () => advertising.createPlacement(request, input),
    "placement-update": () => advertising.updatePlacement(request, id, input),
    "creative-create": () => advertising.createCreative(request, input),
    "creative-update": () => advertising.updateCreative(request, id, input),
    "creative-delete": () => advertising.deleteCreative(request, id),
    seller: () => seller.update(request, "ads", sellerInput),
    page: () => page.updateSettings(request, input),
  };
  const args = {
    kill: [request.ayinAuth, false, "Reviewed stop"],
    "placement-create": [request.ayinAuth, input],
    "placement-update": [request.ayinAuth, id, input],
    "creative-create": [request.ayinAuth, input],
    "creative-update": [request.ayinAuth, id, input],
    "creative-delete": [request.ayinAuth, id],
    seller: [request.ayinAuth, "ads", sellerInput.text, sellerInput.reason],
    page: [request.ayinAuth, input],
  };
  return { operation, call: calls[command], args: args[command] };
}

describe("Advertising editor current-authority transport", () => {
  it.each(commands)("passes the complete authenticated actor for %s", async (command) => {
    const f = fixture(command);
    await expect(f.call()).resolves.toEqual({ saved: true });
    expect(f.operation).toHaveBeenCalledExactlyOnceWith(...f.args);
  });

  it.each(commands)(
    "preserves authority and uncertain persistence failures for %s",
    async (command) => {
      const f = fixture(command);
      for (const status of [401, 403, 404, 409, 500]) {
        const error = new HttpException({ error: { code: "CONTROLLED_FAILURE" } }, status);
        f.operation.mockRejectedValueOnce(error);
        await expect(f.call()).rejects.toBe(error);
      }
      const unknown = new Error("Database or post-commit snapshot unavailable");
      f.operation.mockRejectedValueOnce(unknown);
      await expect(f.call()).rejects.toBe(unknown);
      expect(f.operation).toHaveBeenCalledTimes(6);
    },
  );

  it.each([
    "placement-create",
    "placement-update",
    "creative-create",
    "creative-update",
    "page",
  ] as const)("still reports schema rejection as bad input for %s", async (command) => {
    const f = fixture(command);
    const parsed = z.string().safeParse(null);
    if (parsed.success) throw Error("Expected invalid test input");
    f.operation.mockRejectedValueOnce(parsed.error);
    await expect(f.call()).rejects.toMatchObject({ status: 400 });
    expect(f.operation).toHaveBeenCalledTimes(1);
  });

  it("rejects seller syntax before opening any transaction", async () => {
    const transaction = vi.fn();
    const service = new AuthorizedSellerFileService(
      { client: { $transaction: transaction } } as unknown as DatabaseService,
      {} as AdminAuditLogService,
      {} as GamProductionService,
    );
    const controller = new AdminAuthorizedSellerFileController(service);
    await expect(
      controller.update(request, "ads", {
        ...sellerInput,
        text: "exchange.example, seller-42, INVALID",
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "INVALID_AUTHORIZED_SELLER_SYNTAX" } },
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
