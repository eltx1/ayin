import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  PrivacyLifecycleService,
} from "../src/privacy/privacy-lifecycle.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const password = "strong-pass-123";

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Task 49 privacy controls", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-49-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_E2E_STORAGE = "1";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: email.split("@")[0], email, password },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    return {
      accountId: body.user.account.id as string,
      channelId: body.user.channel.id as string,
      profileId: body.user.profile.id as string,
      cookie: cookiePair(response.headers["set-cookie"]),
    };
  }

  it("exports only authenticated account data and excludes secrets and privileged internals", async () => {
    const first = await register("privacy-first@example.com");
    const second = await register("privacy-second@example.com");

    await prisma.notification.createMany({
      data: [
        {
          accountId: first.accountId,
          type: "SYSTEM",
          title: "first-only-title",
          body: "first-only-body",
        },
        {
          accountId: second.accountId,
          type: "SYSTEM",
          title: "second-only-title",
          body: "second-only-body",
        },
      ],
    });
    await prisma.mediaAsset.create({
      data: {
        channelId: first.channelId,
        kind: "CHANNEL_AVATAR",
        status: "VALIDATED",
        r2ObjectKey: "private/first/internal-object-key",
        mimeType: "image/png",
        sizeBytes: BigInt(1_024),
        checksum: "private-checksum",
      },
    });
    await prisma.creatorPayoutProfile.create({
      data: {
        channelId: first.channelId,
        legalName: "First Creator",
        preferredCurrency: "USD",
        destinationEncrypted: "encrypted-payout-destination-secret",
        destinationMask: "**** 4242",
      },
    });
    await prisma.liveStream.create({
      data: {
        channelId: first.channelId,
        createdByAccountId: first.accountId,
        slug: "private-live-export-test",
        title: "Export-safe live",
        streamKeyHash: "private-stream-key-hash",
        providerStreamId: "private-provider-stream-id",
        ingestEndpoint: "rtmps://secret.example/live",
        playbackUrl: "https://secret.example/playback",
      },
    });
    const moderationCase = await prisma.moderationCase.create({
      data: { summary: "privileged moderator summary", resolution: "privileged resolution" },
    });
    await prisma.report.create({
      data: {
        reporterProfileId: first.profileId,
        moderationCaseId: moderationCase.id,
        reason: "OTHER",
        details: "user-visible report details",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/privacy/export",
      headers: { cookie: first.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("ayin-data-export-");
    const serialized = response.body;
    expect(serialized).toContain("privacy-first@example.com");
    expect(serialized).toContain("first-only-body");
    expect(serialized).toContain("user-visible report details");
    expect(serialized).toContain("**** 4242");
    expect(serialized).not.toContain("privacy-second@example.com");
    expect(serialized).not.toContain("second-only-body");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("private/first/internal-object-key");
    expect(serialized).not.toContain("private-checksum");
    expect(serialized).not.toContain("encrypted-payout-destination-secret");
    expect(serialized).not.toContain("private-stream-key-hash");
    expect(serialized).not.toContain("private-provider-stream-id");
    expect(serialized).not.toContain("rtmps://secret.example/live");
    expect(serialized).not.toContain("privileged moderator summary");
    expect(serialized).not.toContain("privileged resolution");
    expect(serialized).not.toContain("moderationCaseId");
  });

  it("binds deletion ownership to the authenticated account rather than client-supplied identity", async () => {
    const first = await register("privacy-owner-one@example.com");
    const second = await register("privacy-owner-two@example.com");

    const rejected = await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { cookie: second.cookie },
      payload: {
        password,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
        accountId: first.accountId,
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(await prisma.accountDeletionRequest.count()).toBe(0);

    const accepted = await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { cookie: second.cookie },
      payload: { password, confirmation: ACCOUNT_DELETION_CONFIRMATION },
    });
    expect(accepted.statusCode).toBe(202);
    expect(
      await prisma.accountDeletionRequest.count({ where: { accountId: second.accountId } }),
    ).toBe(1);
    expect(
      await prisma.accountDeletionRequest.count({ where: { accountId: first.accountId } }),
    ).toBe(0);
  });

  it("moves REQUESTED -> GRACE_PERIOD -> DEACTIVATED -> ANONYMIZED while preserving required records", async () => {
    const owner = await register("privacy-lifecycle@example.com");
    const payout = await prisma.payout.create({
      data: {
        channelId: owner.channelId,
        status: "PAID",
        amount: "12.500000",
        currency: "USD",
        destinationEncryptedSnapshot: "retained-financial-snapshot",
        destinationMaskSnapshot: "**** 8899",
        legalNameSnapshot: "Accounting Name",
      },
    });
    const report = await prisma.report.create({
      data: {
        reporterProfileId: owner.profileId,
        reason: "SPAM",
        details: "moderation evidence",
      },
    });
    await prisma.mediaAsset.create({
      data: {
        channelId: owner.channelId,
        kind: "CHANNEL_BANNER",
        status: "VALIDATED",
        r2ObjectKey: `channels/${owner.channelId}/banner.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: BigInt(2_048),
      },
    });

    const requested = await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { cookie: owner.cookie },
      payload: { password, confirmation: ACCOUNT_DELETION_CONFIRMATION },
    });
    expect(requested.statusCode).toBe(202);
    const lifecycle = moduleReference.get(PrivacyLifecycleService);
    const deletion = await prisma.accountDeletionRequest.findFirstOrThrow({
      where: { accountId: owner.accountId },
    });
    expect(deletion.state).toBe("REQUESTED");

    const now = new Date();
    expect(await lifecycle.advanceDue(now)).toBe(1);
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: deletion.id } })).state,
    ).toBe("GRACE_PERIOD");

    await prisma.accountDeletionRequest.update({
      where: { id: deletion.id },
      data: { graceEndsAt: new Date(now.getTime() - 1_000) },
    });
    expect(await lifecycle.advanceDue(now)).toBe(1);
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: deletion.id } })).state,
    ).toBe("DEACTIVATED");
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: owner.accountId } })).status,
    ).toBe("CLOSED");
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(401);

    await prisma.accountDeletionRequest.update({
      where: { id: deletion.id },
      data: { deactivatedAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000) },
    });
    expect(await lifecycle.advanceDue(now)).toBe(1);
    const finalRequest = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: deletion.id },
    });
    expect(finalRequest.state).toBe("ANONYMIZED");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: owner.accountId } });
    expect(account.email).toBe(`deleted+${owner.accountId}@deleted.ayin.invalid`);
    expect(account.displayName).toBe("Deleted AYIN user");
    expect(account.passwordHash).toBeNull();
    expect(
      (await prisma.viewerProfile.findUniqueOrThrow({ where: { id: owner.profileId } })).name,
    ).toBe("Deleted profile");
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: owner.channelId } })).status,
    ).toBe("REMOVED");

    expect(
      (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }))
        .destinationEncryptedSnapshot,
    ).toBe("retained-financial-snapshot");
    expect(await prisma.report.findUnique({ where: { id: report.id } })).not.toBeNull();
    expect(
      await prisma.privacyMediaDeletionJob.count({ where: { requestId: deletion.id } }),
    ).toBeGreaterThan(0);
  });

  it("does not remove a creator channel or its media when another owner remains", async () => {
    const deletingOwner = await register("privacy-shared-owner-delete@example.com");
    const remainingOwner = await register("privacy-shared-owner-remain@example.com");
    await prisma.channelMember.create({
      data: {
        channelId: deletingOwner.channelId,
        accountId: remainingOwner.accountId,
        role: "OWNER",
      },
    });
    const video = await prisma.video.create({
      data: {
        channelId: deletingOwner.channelId,
        slug: `shared-delete-${Date.now()}`,
        title: "Shared ownership survives deletion",
        status: "DRAFT",
        visibility: "PRIVATE",
      },
    });
    const media = await prisma.mediaAsset.create({
      data: {
        channelId: deletingOwner.channelId,
        kind: "CHANNEL_BANNER",
        status: "VALIDATED",
        r2ObjectKey: `channels/${deletingOwner.channelId}/shared-banner.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: BigInt(1_024),
      },
    });

    const requested = await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { cookie: deletingOwner.cookie },
      payload: { password, confirmation: ACCOUNT_DELETION_CONFIRMATION },
    });
    expect(requested.statusCode).toBe(202);

    const lifecycle = moduleReference.get(PrivacyLifecycleService);
    const deletion = await prisma.accountDeletionRequest.findFirstOrThrow({
      where: { accountId: deletingOwner.accountId },
    });
    const now = new Date();
    await lifecycle.advanceDue(now);
    await prisma.accountDeletionRequest.update({
      where: { id: deletion.id },
      data: { graceEndsAt: new Date(now.getTime() - 1_000) },
    });
    await lifecycle.advanceDue(now);
    await prisma.accountDeletionRequest.update({
      where: { id: deletion.id },
      data: { deactivatedAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000) },
    });
    await lifecycle.advanceDue(now);

    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: deletingOwner.channelId } })).status,
    ).toBe("ACTIVE");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("DRAFT");
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })).status).toBe(
      "VALIDATED",
    );
    expect(
      await prisma.channelMember.count({
        where: {
          channelId: deletingOwner.channelId,
          accountId: remainingOwner.accountId,
          role: "OWNER",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.privacyMediaDeletionJob.count({
        where: { requestId: deletion.id, target: media.r2ObjectKey },
      }),
    ).toBe(0);
  });

  it("allows audited admin recovery before anonymization and refuses recovery afterward", async () => {
    const actor = await register("privacy-recovery-actor@example.com");
    const target = await register("privacy-recovery-target@example.com");
    const lifecycle = moduleReference.get(PrivacyLifecycleService);

    await app.inject({
      method: "POST",
      url: "/privacy/deletion",
      headers: { cookie: target.cookie },
      payload: { password, confirmation: ACCOUNT_DELETION_CONFIRMATION },
    });
    const request = await prisma.accountDeletionRequest.findFirstOrThrow({
      where: { accountId: target.accountId },
    });
    const now = new Date();
    await lifecycle.advanceDue(now);
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { graceEndsAt: new Date(now.getTime() - 1_000) },
    });
    await lifecycle.advanceDue(now);

    const recovered = await lifecycle.adminRecover(
      actor.accountId,
      target.accountId,
      "Verified ownership before anonymization",
    );
    expect(recovered).toEqual({ recovered: true, previousState: "DEACTIVATED" });
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).state,
    ).toBe("CANCELLED");
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: target.accountId } })).status,
    ).toBe("ACTIVE");
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: "privacy.deletion_admin_recovered", entityId: target.accountId },
    });
    expect(audit.actorAccountId).toBe(actor.accountId);
    expect(audit.reason).toBe("Verified ownership before anonymization");
  });
});
