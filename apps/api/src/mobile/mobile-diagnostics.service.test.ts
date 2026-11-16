import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@ayin/db";
import type { DatabaseService } from "../database/database.service.js";
import { MobileDiagnosticsService } from "./mobile-diagnostics.service.js";
import type { MobileConfigService } from "./mobile-config.service.js";
import { defaultMobileRuntimeConfig } from "./mobile.schemas.js";
import type { MobileDiagnosticInput } from "./mobile-diagnostics.schema.js";

const actor = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 2,
};
const profileId = "33333333-3333-4333-8333-333333333333";
const input: MobileDiagnosticInput = {
  installationId: "44444444-4444-4444-8444-444444444444",
  platform: "android",
  appVersion: "1.1.0",
  bridgeVersion: 1,
  capabilities: ["ads.webview"],
  configRevision: null,
  configAppliedAt: null,
  lastConfigCheckAt: null,
  ads: { status: "NO_FILL", lastEvent: "ad_failed", errorCode: 3 },
  firebaseConfigured: false,
  runtimeAllowed: true,
  diagnosticsConsent: true,
};
interface Row {
  accountId: string;
  sessionId: string;
  consentVersion: number;
  consentRevokedAt: Date | null;
  receivedAt: Date | null;
  expiresAt: Date;
  snapshot: unknown;
  platform: string | null;
  appVersion: string | null;
  session: { revokedAt: Date | null; expiresAt: Date };
}
function harness() {
  let row: Row | null = {
    accountId: actor.accountId,
    sessionId: actor.sessionId,
    consentVersion: 1,
    consentRevokedAt: null,
    receivedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    snapshot: null,
    platform: null,
    appVersion: null,
    session: { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
  };
  const merge = (data: Partial<Row>) => {
    row = {
      ...(row ?? {
        receivedAt: null,
        snapshot: null,
        platform: null,
        appVersion: null,
        session: { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
      }),
      ...data,
    } as Row;
    if (row.snapshot === Prisma.DbNull) row.snapshot = null;
    return row;
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    account: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", authVersion: 2 }) },
    accountSession: {
      findUnique: vi.fn().mockResolvedValue({
        accountId: actor.accountId,
        authVersion: 2,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
    viewerProfile: { findFirst: vi.fn().mockResolvedValue({ isKids: false }) },
    mobileDiagnostic: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(async () => row),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn(async (args: { create: Partial<Row>; update: Partial<Row> }) =>
        merge(row ? args.update : args.create),
      ),
      update: vi.fn(async (args: { data: Partial<Row> }) => merge(args.data)),
    },
  };
  const get = vi.fn().mockResolvedValue({
    ...defaultMobileRuntimeConfig,
    analytics: { enabled: true },
    ads: { ...defaultMobileRuntimeConfig.ads, audience: "general" },
  });
  const db = { client: { $transaction: vi.fn(async (callback) => callback(tx)) } };
  const service = new MobileDiagnosticsService(
    db as unknown as DatabaseService,
    { get } as unknown as MobileConfigService,
  );
  return {
    service,
    tx,
    get,
    setRow(value: Row | null) {
      row = value;
    },
    current: () => row,
  };
}
describe("mobile diagnostic authority and consent revocation barriers", () => {
  it("requires current authority and the explicitly selected owned non-Kids profile", async () => {
    const { service, tx } = harness();
    expect((await service.record(actor, input, profileId, 1)).accepted).toBe(true);
    expect(tx.viewerProfile.findFirst).toHaveBeenCalledWith({
      where: { id: profileId, accountId: actor.accountId, deletedAt: null },
      select: { isKids: true },
    });
    expect(tx.mobileDiagnostic.update.mock.calls[0]![0].data.snapshot).toEqual(input);
    tx.viewerProfile.findFirst.mockResolvedValueOnce({ isKids: true });
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 403 });
    tx.viewerProfile.findFirst.mockResolvedValueOnce(null);
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects disabled configuration and revoked sessions", async () => {
    const { service, tx, get } = harness();
    get.mockResolvedValueOnce(defaultMobileRuntimeConfig);
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 403 });
    expect(tx.mobileDiagnostic.update).not.toHaveBeenCalled();
    tx.accountSession.findUnique.mockResolvedValueOnce({
      accountId: actor.accountId,
      authVersion: 2,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 401 });
  });
  it("allows one report per minute, expires after seven days and limits grants to twenty installations", async () => {
    const { service, tx, setRow } = harness();
    const accepted = await service.record(actor, input, profileId, 1);
    expect(Date.parse(accepted.expiresAt) - Date.parse(accepted.receivedAt)).toBe(
      7 * 24 * 60 * 60_000,
    );
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 429 });
    setRow(null);
    tx.mobileDiagnostic.count.mockResolvedValueOnce(20);
    await expect(service.grant(actor, input.installationId, profileId, 0)).rejects.toMatchObject({
      status: 429,
    });
  });
  it("never overwrites another active account/session binding or revokes it with delayed opt-out", async () => {
    const { service, current, setRow } = harness();
    setRow({ ...current()!, sessionId: "55555555-5555-4555-8555-555555555555" });
    await expect(service.consent(actor, input.installationId, profileId)).rejects.toMatchObject({
      status: 409,
    });
    await expect(service.grant(actor, input.installationId, profileId, 1)).rejects.toMatchObject({
      status: 409,
    });
    await service.remove(actor, input.installationId);
    expect(current()?.consentRevokedAt).toBeNull();
    expect(current()?.consentVersion).toBe(1);
  });
  it("blocks both a late grant and an old report after opt-out, including delete-before-first-grant", async () => {
    const { service, setRow, current } = harness();
    setRow(null);
    const before = await service.consent(actor, input.installationId, profileId);
    expect(before).toEqual({ enabled: false, consentVersion: 0, expiresAt: null });
    await service.remove(actor, input.installationId);
    await expect(
      service.grant(actor, input.installationId, profileId, before.consentVersion),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await service.consent(actor, input.installationId, profileId);
    const granted = await service.grant(
      actor,
      input.installationId,
      profileId,
      fresh.consentVersion,
    );
    expect(granted.consentVersion).toBe(2);
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 403 });
    await service.record(actor, input, profileId, granted.consentVersion);
    await service.remove(actor, input.installationId);
    expect(current()?.snapshot).toBeNull();
    await expect(
      service.record(actor, input, profileId, granted.consentVersion),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not reset the reporting rate or version when an already active grant is read/reaffirmed", async () => {
    const { service, tx } = harness();
    await service.record(actor, input, profileId, 1);
    expect((await service.grant(actor, input.installationId, profileId, 1)).consentVersion).toBe(1);
    expect(tx.mobileDiagnostic.upsert).not.toHaveBeenCalled();
    await expect(service.record(actor, input, profileId, 1)).rejects.toMatchObject({ status: 429 });
  });
});
