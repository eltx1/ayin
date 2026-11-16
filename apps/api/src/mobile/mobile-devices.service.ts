import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { mobilePreferencesSchema, type MobileDeviceInput } from "./mobile.schemas.js";

import { lockMobileAccountWrite, type MobileActor } from "./mobile-authority.js";

export const activeMobileDeviceWhere = (now = new Date()) => ({
  revokedAt: null,
  session: { revokedAt: null, expiresAt: { gt: now } },
  account: { status: "ACTIVE" as const },
});
@Injectable()
export class MobileDevicesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async register(actor: MobileActor, input: MobileDeviceInput) {
    const { accountId, sessionId } = actor;
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    return this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      for (const key of [
        `mobile-device:${input.installationId}`,
        `mobile-token:${tokenHash}`,
      ].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const owner = await tx.mobileDevice.findUnique({
        where: { installationId: input.installationId },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      const now = new Date();
      if (
        owner &&
        owner.sessionId !== sessionId &&
        !owner.revokedAt &&
        !owner.session.revokedAt &&
        owner.session.expiresAt > now
      )
        throw new ConflictException({
          error: {
            code: "DEVICE_ALREADY_BOUND",
            message: "Detach this installation from its earlier session before registering it.",
          },
        });
      const previousToken = await tx.mobileDevice.findUnique({
        where: { tokenHash },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      if (previousToken && previousToken.installationId !== input.installationId) {
        if (
          !previousToken.revokedAt &&
          !previousToken.session.revokedAt &&
          previousToken.session.expiresAt > now
        )
          throw new ConflictException({
            error: {
              code: "TOKEN_ALREADY_BOUND",
              message: "This delivery token is already registered.",
            },
          });
        await tx.mobileDevice.delete({ where: { id: previousToken.id } });
      }
      const activeCount = await tx.mobileDevice.count({
        where: { accountId, ...activeMobileDeviceWhere(now) },
      });
      if (!owner && activeCount >= 20)
        throw new HttpException("Maximum number of registered devices reached.", 429);
      const changedOwner =
        owner && (owner.accountId !== accountId || owner.sessionId !== sessionId);
      const row = await tx.mobileDevice.upsert({
        where: { installationId: input.installationId },
        create: { ...input, tokenHash, accountId, sessionId, preferences: input.preferences },
        update: {
          ...input,
          tokenHash,
          accountId,
          sessionId,
          revokedAt: null,
          lastSeenAt: now,
          preferences: input.preferences,
          ...(changedOwner ? { notificationCursorAt: now } : {}),
        },
        select: { installationId: true, platform: true, appVersion: true, preferences: true },
      });
      return { ...row, enabled: Object.values(input.preferences).some(Boolean) };
    });
  }
  async get(accountId: string, sessionId: string, installationId: string) {
    const row = await this.db.client.mobileDevice.findFirst({
      where: { installationId, accountId, sessionId, ...activeMobileDeviceWhere() },
      select: { preferences: true },
    });
    if (!row) throw new NotFoundException("This mobile registration is not available.");
    const parsed = mobilePreferencesSchema.safeParse(row.preferences);
    const preferences = parsed.success ? parsed.data : mobilePreferencesSchema.parse({});
    return { preferences, enabled: Object.values(preferences).some(Boolean) };
  }
  async remove(actor: MobileActor, installationId: string) {
    // Scope deletion to the session too: a delayed logout must not unregister a later login.
    await this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      await tx.mobileDevice.deleteMany({
        where: { installationId, accountId: actor.accountId, sessionId: actor.sessionId },
      });
    });
    return { removed: true };
  }
}
