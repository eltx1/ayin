import { Prisma } from "@ayin/db";
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { lockMobileAccountWrite, type MobileActor } from "./mobile-authority.js";
import { MobileConfigService } from "./mobile-config.service.js";
import { mobileDiagnosticSchema, type MobileDiagnosticInput } from "./mobile-diagnostics.schema.js";

export const MOBILE_DIAGNOSTIC_TTL_MS = 7 * 24 * 60 * 60_000;
export const MOBILE_DIAGNOSTIC_INTERVAL_MS = 60_000;
export const MAX_DIAGNOSTIC_CONSENT_VERSION = 1_000_000_000;
type DiagnosticOwner = {
  accountId: string;
  sessionId: string;
  consentVersion: number;
  session: { revokedAt: Date | null; expiresAt: Date };
};
@Injectable()
export class MobileDiagnosticsService implements OnApplicationBootstrap, OnModuleDestroy {
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MobileConfigService) private readonly config: MobileConfigService,
  ) {}
  onApplicationBootstrap() {
    this.cleanupTimer = setInterval(() => {
      void this.purgeExpired().catch(() => undefined);
    }, 60 * 60_000);
    this.cleanupTimer.unref();
  }
  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }
  private purgeExpired() {
    return this.db.client.mobileDiagnostic.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
  private async requireProfile(
    tx: Prisma.TransactionClient,
    actor: MobileActor,
    profileId: string,
  ) {
    const profile = await tx.viewerProfile.findFirst({
      where: { id: profileId, accountId: actor.accountId, deletedAt: null },
      select: { isKids: true },
    });
    if (!profile || profile.isKids)
      throw new ForbiddenException("App diagnostics require an eligible viewer profile.");
  }
  private async requireConfiguration() {
    const config = await this.config.get();
    if (!config.analytics.enabled || config.ads.audience !== "general")
      throw new ForbiddenException("Optional app diagnostics are disabled.");
  }
  private async lockInstallation(tx: Prisma.TransactionClient, installationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mobile-diagnostic:${installationId}`}))`;
    const now = new Date();
    await tx.mobileDiagnostic.deleteMany({ where: { expiresAt: { lte: now } } });
    return now;
  }
  private assertAvailable(previous: DiagnosticOwner | null, actor: MobileActor, now: Date) {
    if (
      previous &&
      (previous.accountId !== actor.accountId || previous.sessionId !== actor.sessionId) &&
      !previous.session.revokedAt &&
      previous.session.expiresAt > now
    )
      throw new ConflictException("This diagnostic installation is bound to another session.");
  }
  private async checkCount(
    tx: Prisma.TransactionClient,
    actor: MobileActor,
    previous: DiagnosticOwner | null,
  ) {
    if (
      (!previous || previous.accountId !== actor.accountId) &&
      (await tx.mobileDiagnostic.count({ where: { accountId: actor.accountId } })) >= 20
    )
      throw new HttpException("Maximum number of diagnostic installations reached.", 429);
  }
  private nextVersion(version: number) {
    if (version >= MAX_DIAGNOSTIC_CONSENT_VERSION)
      throw new HttpException("Diagnostic consent update limit reached.", 429);
    return version + 1;
  }
  async consent(actor: MobileActor, installationId: string, profileId: string) {
    return this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      await this.requireProfile(tx, actor, profileId);
      const now = await this.lockInstallation(tx, installationId);
      const row = await tx.mobileDiagnostic.findUnique({
        where: { installationId },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      this.assertAvailable(row, actor, now);
      return {
        consentVersion: row?.consentVersion ?? 0,
        enabled: Boolean(
          row &&
          row.accountId === actor.accountId &&
          row.sessionId === actor.sessionId &&
          !row.consentRevokedAt,
        ),
        expiresAt: row?.expiresAt.toISOString() ?? null,
      };
    });
  }
  async grant(
    actor: MobileActor,
    installationId: string,
    profileId: string,
    expectedConsentVersion: number,
  ) {
    await this.requireConfiguration();
    return this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      await this.requireProfile(tx, actor, profileId);
      const now = await this.lockInstallation(tx, installationId);
      const row = await tx.mobileDiagnostic.findUnique({
        where: { installationId },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      this.assertAvailable(row, actor, now);
      if (expectedConsentVersion !== (row?.consentVersion ?? 0))
        throw new ConflictException(
          "Diagnostic consent changed. Read it again before explicitly enabling.",
        );
      if (
        row &&
        row.accountId === actor.accountId &&
        row.sessionId === actor.sessionId &&
        !row.consentRevokedAt
      )
        return {
          enabled: true,
          consentVersion: row.consentVersion,
          expiresAt: row.expiresAt.toISOString(),
        };
      await this.checkCount(tx, actor, row);
      const version = this.nextVersion(row?.consentVersion ?? 0),
        expiresAt = new Date(now.getTime() + MOBILE_DIAGNOSTIC_TTL_MS);
      await tx.mobileDiagnostic.upsert({
        where: { installationId },
        create: {
          installationId,
          accountId: actor.accountId,
          sessionId: actor.sessionId,
          consentVersion: version,
          consentRevokedAt: null,
          expiresAt,
        },
        update: {
          accountId: actor.accountId,
          sessionId: actor.sessionId,
          consentVersion: version,
          consentRevokedAt: null,
          expiresAt,
          snapshot: Prisma.DbNull,
          platform: null,
          appVersion: null,
        },
      });
      return { enabled: true, consentVersion: version, expiresAt: expiresAt.toISOString() };
    });
  }
  async record(
    actor: MobileActor,
    raw: MobileDiagnosticInput,
    profileId: string,
    consentVersion: number,
  ) {
    const input = mobileDiagnosticSchema.parse(raw);
    await this.requireConfiguration();
    return this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      await this.requireProfile(tx, actor, profileId);
      const now = await this.lockInstallation(tx, input.installationId);
      const previous = await tx.mobileDiagnostic.findUnique({
        where: { installationId: input.installationId },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      if (
        !previous ||
        previous.accountId !== actor.accountId ||
        previous.sessionId !== actor.sessionId ||
        previous.consentRevokedAt ||
        previous.consentVersion !== consentVersion
      )
        throw new ForbiddenException("A current explicit diagnostic consent grant is required.");
      if (
        previous.receivedAt &&
        now.getTime() - previous.receivedAt.getTime() < MOBILE_DIAGNOSTIC_INTERVAL_MS
      )
        throw new HttpException("App diagnostic updates are limited to once per minute.", 429);
      const expiresAt = new Date(now.getTime() + MOBILE_DIAGNOSTIC_TTL_MS);
      await tx.mobileDiagnostic.update({
        where: { installationId: input.installationId },
        data: {
          platform: input.platform,
          appVersion: input.appVersion,
          snapshot: input as Prisma.InputJsonValue,
          receivedAt: now,
          expiresAt,
        },
      });
      return { accepted: true, receivedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
    });
  }
  async remove(actor: MobileActor, installationId: string) {
    return this.db.client.$transaction(async (tx) => {
      await lockMobileAccountWrite(tx, actor);
      const now = await this.lockInstallation(tx, installationId);
      const row = await tx.mobileDiagnostic.findUnique({
        where: { installationId },
        include: { session: { select: { revokedAt: true, expiresAt: true } } },
      });
      // A delayed old-account opt-out must not revoke a new account/session's grant.
      if (row && (row.accountId !== actor.accountId || row.sessionId !== actor.sessionId))
        return { removed: true };
      await this.checkCount(tx, actor, row);
      const version = this.nextVersion(row?.consentVersion ?? 0),
        expiresAt = new Date(now.getTime() + MOBILE_DIAGNOSTIC_TTL_MS);
      await tx.mobileDiagnostic.upsert({
        where: { installationId },
        create: {
          installationId,
          accountId: actor.accountId,
          sessionId: actor.sessionId,
          consentVersion: version,
          consentRevokedAt: now,
          expiresAt,
        },
        update: {
          consentVersion: version,
          consentRevokedAt: now,
          expiresAt,
          snapshot: Prisma.DbNull,
          platform: null,
          appVersion: null,
        },
      });
      return { removed: true };
    });
  }
  async list(accountId: string) {
    const now = new Date(),
      account = await this.db.client.account.findUnique({
        where: { id: accountId },
        select: { status: true, authVersion: true },
      });
    if (!account || account.status !== "ACTIVE") return [];
    return this.db.client.mobileDiagnostic.findMany({
      where: {
        accountId,
        expiresAt: { gt: now },
        consentRevokedAt: null,
        snapshot: { not: Prisma.DbNull },
        session: { revokedAt: null, expiresAt: { gt: now }, authVersion: account.authVersion },
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: {
        installationId: true,
        platform: true,
        appVersion: true,
        snapshot: true,
        receivedAt: true,
        expiresAt: true,
      },
    });
  }
}
