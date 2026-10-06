import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advertiserCreateWriteSchema,
  advertiserPatchWriteSchema,
  advertisingDeleteWriteSchema,
  campaignCreateWriteSchema,
  campaignPatchWriteSchema,
  assertAdvertisingVersion,
  nextAdvertisingVersion,
} from "./advertising-write-contract.js";
import { AdminAdvertisingControlController } from "./advertising-control.controller.js";
import type { AdvertisingControlService } from "./advertising-control.service.js";
import type { AdminAuthenticatedRequest } from "../admin/admin.guard.js";

const id = "00000000-0000-4000-8000-000000000001";
const version = "2035-01-01T00:00:00.000Z";
const direct = {
  pricing: { model: "CPM", cpm: "1.25", fixedPrice: null },
  impressionGoal: 1000,
  targeting: {},
};

describe("advertiser/campaign workspace command contracts", () => {
  afterEach(() => vi.restoreAllMocks());
  it("requires a reviewed target version only for correlated update/delete commands", () => {
    for (const schema of [
      advertiserPatchWriteSchema,
      campaignPatchWriteSchema,
      advertisingDeleteWriteSchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ mutationId: id }).success).toBe(false);
      expect(schema.safeParse({ mutationId: id, expectedUpdatedAt: version }).success).toBe(true);
      expect(schema.safeParse({ mutationId: id, expectedUpdatedAt: null }).success).toBe(false);
      expect(schema.safeParse({ mutationId: id, expectedUpdatedAt: "not-a-version" }).success).toBe(
        false,
      );
      expect(
        schema.safeParse({ mutationId: id, expectedUpdatedAt: version, unexpected: true }).success,
      ).toBe(false);
    }
  });
  it("requires the exact reviewed advertiser version on correlated campaign creation", () => {
    const input = { advertiserId: id, name: "Example campaign", direct };
    expect(campaignCreateWriteSchema.safeParse(input).success).toBe(true);
    expect(campaignCreateWriteSchema.safeParse({ ...input, mutationId: id }).success).toBe(false);
    expect(
      campaignCreateWriteSchema.safeParse({
        ...input,
        mutationId: id,
        expectedAdvertiserUpdatedAt: version,
      }).success,
    ).toBe(true);
    expect(
      advertiserCreateWriteSchema.safeParse({ name: "Example advertiser", mutationId: id }).success,
    ).toBe(true);
  });
  it("always advances a millisecond version even with equal or backwards clock", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date(version).getTime());
    const first = nextAdvertisingVersion(new Date(version));
    const second = nextAdvertisingVersion(first);
    expect(first.toISOString()).toBe("2035-01-01T00:00:00.001Z");
    expect(second.toISOString()).toBe("2035-01-01T00:00:00.002Z");
    expect(() => assertAdvertisingVersion(second, version)).toThrow(HttpException);
    try {
      assertAdvertisingVersion(second, version);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(409);
    }
    expect(() => assertAdvertisingVersion(second, second.toISOString())).not.toThrow();
    expect(() => assertAdvertisingVersion(second)).not.toThrow();
  });
  it("preserves authority/conflict/not-found and server failures instead of calling them bad input", async () => {
    const service = { updateAdvertiser: vi.fn() };
    const controller = new AdminAdvertisingControlController(
      service as unknown as AdvertisingControlService,
    );
    const request = {
      ayinAuth: { accountId: id, authVersion: 1, sessionId: id, reauthAt: 123 },
    } as AdminAuthenticatedRequest;
    for (const status of [401, 403, 404, 409, 500]) {
      const error = new HttpException("Expected failure", status);
      service.updateAdvertiser.mockRejectedValueOnce(error);
      await expect(controller.updateAdvertiser(request, id, {})).rejects.toBe(error);
    }
    const error = Error("Unknown commit outcome");
    service.updateAdvertiser.mockRejectedValueOnce(error);
    await expect(controller.updateAdvertiser(request, id, {})).rejects.toBe(error);
    expect(service.updateAdvertiser).toHaveBeenLastCalledWith(request.ayinAuth, id, {});
    for (const [code, status] of [
      ["P2025", 404],
      ["P2003", 409],
      ["P2034", 409],
    ] as const) {
      service.updateAdvertiser.mockRejectedValueOnce({ code });
      await expect(controller.updateAdvertiser(request, id, {})).rejects.toMatchObject({ status });
    }
    const parsed = advertiserPatchWriteSchema.safeParse({ mutationId: id });
    if (parsed.success) throw Error("Expected invalid version");
    service.updateAdvertiser.mockRejectedValueOnce(parsed.error);
    await expect(controller.updateAdvertiser(request, id, {})).rejects.toMatchObject({
      status: 400,
    });
  });
});

it("does not inject create defaults into partial advertiser/campaign updates", () => {
  expect(advertiserPatchWriteSchema.parse({ name: "Name only" })).toEqual({ name: "Name only" });
  expect(campaignPatchWriteSchema.parse({ name: "Name only" })).toEqual({ name: "Name only" });
  expect(campaignPatchWriteSchema.parse({ endsAt: "2035-01-01T00:00:00Z" })).toEqual({
    endsAt: new Date("2035-01-01T00:00:00Z"),
  });
  expect(campaignPatchWriteSchema.parse({ currency: null, budget: null, startsAt: null })).toEqual({
    currency: null,
    budget: null,
    startsAt: null,
  });
});
