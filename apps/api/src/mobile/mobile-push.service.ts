import { createHash } from "node:crypto";
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Notification, NotificationType, Prisma } from "@ayin/db";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { MobileConfigService } from "./mobile-config.service.js";
import { activeMobileDeviceWhere } from "./mobile-devices.service.js";
import { FcmHttpV1Service } from "./fcm-http-v1.service.js";
import {
  mobileDestinationSchema,
  mobileNotificationTypeSchema,
  mobilePreferencesSchema,
  type MobilePushInput,
} from "./mobile.schemas.js";

import { lockMobileAdminWrite, type MobileActor } from "./mobile-authority.js";

const dataObject = (data: unknown): Record<string, unknown> =>
  data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
const uuid = (value: unknown): string | null => {
  const result = z.string().uuid().safeParse(value);
  return result.success ? result.data : null;
};
@Injectable()
export class MobilePushService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private lastDeviceId: string | null = null;
  private readonly logger = new Logger(MobilePushService.name);
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MobileConfigService) private readonly config: MobileConfigService,
    @Inject(FcmHttpV1Service) private readonly fcm: FcmHttpV1Service,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}
  onModuleInit() {
    // Explicit deployment gate plus runtime switch. Installing this module never sends a push.
    if (process.env.MOBILE_PUSH_WORKER_ENABLED !== "true") return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.logger.warn("Mobile push sweep failed; no tokens or provider payloads are logged.");
      });
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  status() {
    return {
      credentialsConfigured: this.fcm.isConfigured(),
      workerEnabled: process.env.MOBILE_PUSH_WORKER_ENABLED === "true",
      transport: "fcm-http-v1",
      richMediaSupported: false,
      deliveryEvidence: "Provider acceptance is not evidence of receipt on a physical device.",
    };
  }
  async deliveries(accountId: string) {
    return this.db.client.mobilePushDelivery.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        installationId: true,
        notificationId: true,
        type: true,
        status: true,
        providerCode: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }
  async sendTargeted(actor: MobileActor, input: MobilePushInput) {
    const actorAccountId = actor.accountId;
    const config = await this.config.get();
    if (!config.notifications.enabled)
      throw new ServiceUnavailableException(
        "Mobile notifications are disabled in AYIN runtime settings.",
      );
    if (!this.fcm.isConfigured())
      throw new ServiceUnavailableException(
        "Configure backend FCM credentials through the deployment secret store before testing delivery.",
      );
    const devices = await this.db.client.mobileDevice.findMany({
      where: {
        accountId: input.accountId,
        ...(input.installationId ? { installationId: input.installationId } : {}),
        ...activeMobileDeviceWhere(),
      },
      select: { id: true },
      take: 20,
    });
    if (!devices.length)
      throw new NotFoundException("No active registered device matched this target.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...input, reason: undefined }))
      .digest("hex");
    const notification = await this.db.client.$transaction(async (tx) => {
      await lockMobileAdminWrite(tx, actor, input.accountId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mobile-admin:${actorAccountId}`}))`;
      const existing = await tx.notification.findUnique({ where: { id: input.dedupeKey } });
      if (existing) {
        const old = dataObject(existing.data);
        if (
          existing.accountId !== input.accountId ||
          old.mobileAdminFingerprint !== fingerprint ||
          old.actorAccountId !== actorAccountId
        )
          throw new ConflictException("This deduplication key belongs to a different request.");
        return existing;
      }
      const recent = await tx.adminAuditLog.count({
        where: {
          actorAccountId,
          action: "mobile.push.requested",
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      });
      if (recent >= 10) throw new HttpException("Targeted notification rate limit reached.", 429);
      const created = await tx.notification.create({
        data: {
          id: input.dedupeKey,
          accountId: input.accountId,
          type: input.type.toUpperCase() as NotificationType,
          title: input.title,
          body: input.body,
          data: {
            mobileAdminTest: true,
            mobileAdminFingerprint: fingerprint,
            actorAccountId,
            mobileDestination: input.destination,
            installationId: input.installationId ?? null,
          },
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "mobile.push.requested",
        entityType: "Notification",
        entityId: created.id,
        reason: input.reason,
        metadata: {
          targetAccountId: input.accountId,
          deviceCount: devices.length,
          type: input.type,
        },
      });
      return created;
    });
    const results = [];
    for (const device of devices)
      results.push(await this.deliver(device.id, notification, true, actor));
    return { notificationId: notification.id, results };
  }
  async destination(accountId: string, notificationId: string) {
    const notification = await this.db.client.notification.findFirst({
      where: { id: notificationId, accountId },
    });
    if (!notification) throw new NotFoundException("This notification is not available.");
    const data = dataObject(notification.data);
    if (await this.isBlocked(accountId, data)) return { path: "/notifications" };
    const parsed = mobileDestinationSchema.safeParse(data.mobileDestination);
    const destination = parsed.success
      ? parsed.data
      : uuid(data.videoId)
        ? { kind: "video" as const, id: uuid(data.videoId)! }
        : uuid(data.channelId)
          ? { kind: "channel" as const, id: uuid(data.channelId)! }
          : { kind: "notifications" as const };
    if (destination.kind === "video") {
      // URLs reveal only currently public content. Private/removed/territory-denied playback
      // remains protected by the existing watch API and resolves to the inbox here.
      const video = await this.db.client.video.findFirst({
        where: {
          id: destination.id,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          removedAt: null,
          channel: { status: "ACTIVE", removedAt: null },
        },
        select: { slug: true },
      });
      if (video) return { path: `/watch/${encodeURIComponent(video.slug)}` };
    }
    if (destination.kind === "channel") {
      const channel = await this.db.client.channel.findFirst({
        where: { id: destination.id, status: "ACTIVE", removedAt: null },
        select: { handle: true },
      });
      if (channel) return { path: `/c/${encodeURIComponent(channel.handle)}` };
    }
    return { path: "/notifications" };
  }
  async tick() {
    if (this.busy || !this.fcm.isConfigured()) return;
    this.busy = true;
    try {
      if (!(await this.config.get()).notifications.enabled) return;
      const devices = await this.db.client.mobileDevice.findMany({
        where: {
          ...activeMobileDeviceWhere(),
          ...(this.lastDeviceId ? { id: { gt: this.lastDeviceId } } : {}),
          lastSeenAt: { gt: new Date(Date.now() - 30 * 86400000) },
        },
        orderBy: { id: "asc" },
        take: 25,
        select: { id: true, accountId: true, installationId: true, notificationCursorAt: true },
      });
      const deadline = Date.now() + 20000;
      let processed = 0;
      for (const device of devices) {
        if (Date.now() >= deadline) break;
        const notifications = await this.db.client.notification.findMany({
          where: {
            accountId: device.accountId,
            createdAt: {
              gte: new Date(Math.max(device.notificationCursorAt.getTime(), Date.now() - 86400000)),
            },
            mobilePushDeliveries: { none: { installationId: device.installationId } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 10,
        });
        for (const notification of notifications) {
          if (Date.now() >= deadline) break;
          await this.deliver(device.id, notification, false);
        }
        this.lastDeviceId = device.id;
        processed += 1;
      }
      if (devices.length < 25 && processed === devices.length) this.lastDeviceId = null;
      await this.db.client.mobilePushDelivery.updateMany({
        where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 15 * 60000) } },
        data: {
          status: "FAILED",
          providerCode: "DELIVERY_OUTCOME_UNKNOWN",
          completedAt: new Date(),
        },
      });
      await this.db.client.mobilePushDelivery.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      });
      // Cleanup addresses that cannot be used anymore; delivery audit rows keep no token.
      await this.db.client.mobileDevice.deleteMany({
        where: {
          OR: [
            { revokedAt: { not: null } },
            { lastSeenAt: { lt: new Date(Date.now() - 90 * 86400000) } },
            { session: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }] } },
          ],
        },
      });
    } finally {
      this.busy = false;
    }
  }
  private async deliver(
    deviceId: string,
    notification: Notification,
    explicitTest: boolean,
    actor?: MobileActor,
  ) {
    const runtime = await this.config.get();
    if (!runtime.notifications.enabled) return { status: "SUPPRESSED", code: "DISABLED" };
    const typeResult = mobileNotificationTypeSchema.safeParse(notification.type.toLowerCase());
    if (!typeResult.success) return { status: "SUPPRESSED", code: "UNSUPPORTED_TYPE" };
    const type = typeResult.data;
    const claimed = await this.db.client.$transaction(async (tx) => {
      if (actor) await lockMobileAdminWrite(tx, actor, notification.accountId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mobile-send:${deviceId}`}))`;
      const device = await tx.mobileDevice.findFirst({
        where: { id: deviceId, accountId: notification.accountId, ...activeMobileDeviceWhere() },
        include: {
          session: { select: { authVersion: true } },
          account: { select: { authVersion: true } },
        },
      });
      if (!device || device.session.authVersion !== device.account.authVersion) return null;
      const dedupeKey = `notification:${notification.id}`;
      const existing = await tx.mobilePushDelivery.findUnique({
        where: { installationId_dedupeKey: { installationId: device.installationId, dedupeKey } },
      });
      if (existing) return { existing };
      const preferences = mobilePreferencesSchema.safeParse(device.preferences);
      const data = dataObject(notification.data);
      let suppression: string | null =
        !preferences.success ||
        !preferences.data[type] ||
        !runtime.notifications.types.includes(type)
          ? "PREFERENCE_DISABLED"
          : null;
      if (data.mobileAdminTest === true && !explicitTest) suppression = "ADMIN_TARGET_ONLY";
      if (await this.isBlocked(notification.accountId, data, tx)) suppression = "USER_BLOCKED";
      const recent = await tx.mobilePushDelivery.count({
        where: {
          installationId: device.installationId,
          status: { in: ["PENDING", "SENT", "FAILED"] },
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      });
      if (recent >= 5) suppression = "DEVICE_RATE_LIMIT";
      const delivery = await tx.mobilePushDelivery.create({
        data: {
          deviceId: device.id,
          installationId: device.installationId,
          accountId: notification.accountId,
          notificationId: notification.id,
          dedupeKey,
          type,
          status: suppression ? "SUPPRESSED" : "PENDING",
          providerCode: suppression,
          ...(suppression ? { completedAt: new Date() } : {}),
        },
      });
      return { device, delivery, suppression };
    });
    if (!claimed) return { status: "SUPPRESSED", code: "SESSION_OR_DEVICE_REVOKED" };
    if ("existing" in claimed) return { status: claimed.existing.status, code: "DEDUPLICATED" };
    if (claimed.suppression) return { status: "SUPPRESSED", code: claimed.suppression };
    // Check again immediately before external dispatch; OS-queued pushes still cannot be recalled.
    const stillActive = await this.db.client.mobileDevice.findFirst({
      where: {
        id: claimed.device.id,
        accountId: notification.accountId,
        sessionId: claimed.device.sessionId,
        tokenHash: claimed.device.tokenHash,
        ...activeMobileDeviceWhere(),
      },
      select: {
        id: true,
        preferences: true,
        account: { select: { authVersion: true } },
        session: { select: { authVersion: true } },
      },
    });
    if (actor)
      await this.db.client.$transaction((tx) =>
        lockMobileAdminWrite(tx, actor, notification.accountId),
      );
    const latestConfig = await this.config.get();
    const latestPreferences = mobilePreferencesSchema.safeParse(stillActive?.preferences);
    const allowed =
      stillActive &&
      stillActive.account.authVersion === stillActive.session.authVersion &&
      latestPreferences.success &&
      latestPreferences.data[type] &&
      latestConfig.notifications.enabled &&
      latestConfig.notifications.types.includes(type) &&
      !(await this.isBlocked(notification.accountId, dataObject(notification.data)));
    const result = allowed
      ? await this.fcm.send({
          token: claimed.device.token,
          platform: claimed.device.platform,
          accountId: notification.accountId,
          notificationId: notification.id,
          type,
          title: explicitTest ? notification.title : "AYIN",
          body: explicitTest
            ? (notification.body ?? "Test notification")
            : "You have a new notification.",
        })
      : { accepted: false, code: "SESSION_OR_DEVICE_REVOKED", invalidToken: false };
    await this.db.client.mobilePushDelivery.update({
      where: { id: claimed.delivery.id },
      data: {
        status: result.accepted ? "SENT" : "FAILED",
        providerCode: result.code,
        ...(result.messageId ? { providerMessageId: result.messageId } : {}),
        completedAt: new Date(),
      },
    });
    if (result.invalidToken)
      await this.db.client.mobileDevice.deleteMany({
        where: { id: claimed.device.id, tokenHash: claimed.device.tokenHash },
      });
    return { status: result.accepted ? "SENT" : "FAILED", code: result.code };
  }
  private async isBlocked(
    accountId: string,
    data: Record<string, unknown>,
    tx: Prisma.TransactionClient = this.db.client,
  ) {
    const senders = new Set(
      [uuid(data.actorAccountId), uuid(data.senderAccountId), uuid(data.authorAccountId)].filter(
        (v): v is string => v !== null,
      ),
    );
    if (uuid(data.profileId)) {
      const profile = await tx.viewerProfile.findUnique({
        where: { id: uuid(data.profileId)! },
        select: { accountId: true },
      });
      if (profile) senders.add(profile.accountId);
    }
    let channelId = uuid(data.channelId);
    const destination = mobileDestinationSchema.safeParse(data.mobileDestination);
    if (destination.success && destination.data.kind === "channel") channelId = destination.data.id;
    const videoId =
      destination.success && destination.data.kind === "video"
        ? destination.data.id
        : uuid(data.videoId);
    if (videoId) {
      const video = await tx.video.findUnique({
        where: { id: videoId },
        select: { channelId: true },
      });
      if (video) channelId = video.channelId;
    }
    if (channelId) {
      const owners = await tx.channelMember.findMany({
        where: { channelId, role: "OWNER" },
        select: { accountId: true },
      });
      for (const owner of owners) senders.add(owner.accountId);
    }
    senders.delete(accountId);
    if (!senders.size) return false;
    return Boolean(
      await tx.userBlock.findFirst({
        where: {
          OR: [
            { blockerAccountId: accountId, blockedAccountId: { in: [...senders] } },
            { blockedAccountId: accountId, blockerAccountId: { in: [...senders] } },
          ],
        },
        select: { blockerAccountId: true },
      }),
    );
  }
}
