import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AuthConfig } from "./auth.config.js";
import { AuthHttpError, unauthorized } from "./auth.errors.js";
import { AuthTokenService, type AuthTokenPayload } from "./auth-token.service.js";
import { describeSessionDevice } from "./session-device.js";

export interface SessionRequestMetadata {
  userAgent?: string;
}

export interface SessionAssurance {
  mfaAt?: number;
  mfaVersion?: number;
  reauthAt?: number;
}

@Injectable()
export class SessionService {
  private static readonly activityWriteIntervalMs = 5 * 60 * 1_000;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthConfig) private readonly config: AuthConfig,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
  ) {}

  async create(
    accountId: string,
    authVersion: number,
    assurance: SessionAssurance,
    metadata: SessionRequestMetadata,
  ): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1_000);
    const session = await this.database.client.accountSession.create({
      data: {
        accountId,
        authVersion,
        deviceLabel: describeSessionDevice(metadata.userAgent),
        createdAt: now,
        lastActiveAt: now,
        expiresAt,
      },
      select: { id: true },
    });
    return this.tokens.issueSession(accountId, authVersion, session.id, expiresAt, assurance);
  }

  async rotate(
    accountId: string,
    sessionId: string,
    authVersion: number,
    assurance: SessionAssurance,
  ): Promise<string> {
    const session = await this.database.client.accountSession.findFirst({
      where: {
        id: sessionId,
        accountId,
        authVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { expiresAt: true },
    });
    if (!session) throw unauthorized();
    return this.tokens.issueSession(
      accountId,
      authVersion,
      sessionId,
      session.expiresAt,
      assurance,
    );
  }

  async authenticate(payload: AuthTokenPayload) {
    if (!payload.sid) throw unauthorized();
    const now = new Date();
    const session = await this.database.client.accountSession.findFirst({
      where: {
        id: payload.sid,
        accountId: payload.sub,
        authVersion: payload.av,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        lastActiveAt: true,
        account: { select: { authVersion: true, status: true } },
      },
    });
    if (
      !session ||
      session.account.status !== "ACTIVE" ||
      session.account.authVersion !== payload.av
    ) {
      throw unauthorized();
    }

    const activityThreshold = new Date(now.getTime() - SessionService.activityWriteIntervalMs);
    if (session.lastActiveAt <= activityThreshold) {
      await this.database.client.accountSession.updateMany({
        where: { id: session.id, revokedAt: null, lastActiveAt: { lte: activityThreshold } },
        data: { lastActiveAt: now },
      });
    }
    return { sessionId: session.id };
  }

  async list(accountId: string, currentSessionId: string) {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { authVersion: true },
    });
    if (!account) throw unauthorized();
    const sessions = await this.database.client.accountSession.findMany({
      where: {
        accountId,
        authVersion: account.authVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ lastActiveAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        deviceLabel: true,
        createdAt: true,
        lastActiveAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    return {
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
        status: "ACTIVE" as const,
      })),
    };
  }

  async revoke(accountId: string, sessionId: string, currentSessionId: string) {
    const result = await this.database.client.accountSession.updateMany({
      where: {
        id: sessionId,
        accountId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED" },
    });
    if (result.count !== 1) {
      throw new AuthHttpError(404, "SESSION_NOT_FOUND", "The active session was not found.");
    }
    return { revoked: true, currentSessionRevoked: sessionId === currentSessionId };
  }

  async revokeOthers(accountId: string, currentSessionId: string) {
    const result = await this.database.client.accountSession.updateMany({
      where: {
        accountId,
        id: { not: currentSessionId },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_OTHERS" },
    });
    return { revoked: result.count };
  }

  async logout(payload: AuthTokenPayload | null): Promise<void> {
    if (!payload?.sid) return;
    await this.database.client.accountSession.updateMany({
      where: { id: payload.sid, accountId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "LOGOUT" },
    });
  }
}
