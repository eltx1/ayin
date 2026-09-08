import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { AuthConfig } from "./auth.config.js";
import { AuthHttpError, conflict, isUniqueConstraintError, unauthorized } from "./auth.errors.js";
import { AuthTokenService } from "./auth-token.service.js";
import {
  CreatorProvisioningService,
  ProvisioningConflictError,
} from "./creator-provisioning.service.js";
import { EMAIL_ADAPTER, type EmailAdapter } from "./email.adapter.js";
import { PasswordService } from "./password.service.js";
import { MfaService } from "./mfa.service.js";
import {
  type ForgotPasswordInput,
  type ChangePasswordInput,
  type LoginInput,
  normalizeEmail,
  type RegisterInput,
  type ResetPasswordInput,
} from "./schemas.js";
import { SessionService, type SessionRequestMetadata } from "./session.service.js";

export interface PublicIdentity {
  account: {
    displayName: string;
    email: string;
    id: string;
  };
  channel: {
    handle: string;
    id: string;
    name: string;
  };
  creatorTv: {
    id: string;
    name: string;
    slug: string;
  };
  profile: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface SessionResult {
  token: string;
  user: PublicIdentity;
  recoveryCodes?: string[];
}

export interface MfaLoginResult {
  mfaRequired: true;
  enrollmentRequired: boolean;
  challengeToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwordService: PasswordService,
    @Inject(AuthTokenService) private readonly tokenService: AuthTokenService,
    @Inject(CreatorProvisioningService)
    private readonly provisioning: CreatorProvisioningService,
    @Inject(AuthConfig) private readonly config: AuthConfig,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async register(input: RegisterInput, metadata: SessionRequestMetadata): Promise<SessionResult> {
    const registrationPolicy = await this.platformSettings.getRegistrationPolicy();
    if (!registrationPolicy.registrationEnabled) {
      throw new AuthHttpError(
        503,
        "REGISTRATION_DISABLED",
        "New AYIN registration is temporarily unavailable.",
      );
    }
    if (!registrationPolicy.automaticCreatorProvisioningEnabled) {
      throw new AuthHttpError(
        503,
        "CREATOR_PROVISIONING_DISABLED",
        "New AYIN registration is temporarily unavailable while creator provisioning is paused.",
      );
    }

    const provisioningDefaults = await this.platformSettings.getProvisioningDefaults();
    const email = normalizeEmail(input.email);
    const displayName = input.name.trim();
    const passwordHash = await this.passwordService.hash(input.password);

    try {
      const created = await this.database.client.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            displayName,
            email,
            passwordHash,
          },
          select: {
            authVersion: true,
            displayName: true,
            email: true,
            id: true,
          },
        });

        const provisioned = await this.provisioning.provision(tx, {
          accountId: account.id,
          displayName,
          defaults: provisioningDefaults,
        });

        return { account, provisioned };
      });

      return {
        token: await this.sessions.create(
          created.account.id,
          created.account.authVersion,
          {
            reauthAt: Math.floor(Date.now() / 1_000),
          },
          metadata,
        ),
        user: {
          account: {
            displayName: created.account.displayName,
            email: created.account.email,
            id: created.account.id,
          },
          channel: {
            handle: created.provisioned.channel.handle,
            id: created.provisioned.channel.id,
            name: created.provisioned.channel.name,
          },
          creatorTv: {
            id: created.provisioned.creatorTv.id,
            name: created.provisioned.creatorTv.name,
            slug: created.provisioned.creatorTv.slug,
          },
          profile: {
            id: created.provisioned.profile.id,
            name: created.provisioned.profile.name,
            slug: created.provisioned.profile.slug,
          },
        },
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw conflict("EMAIL_OR_IDENTITY_CONFLICT", "An account with this email already exists.");
      }
      if (error instanceof ProvisioningConflictError) {
        throw conflict(
          "IDENTITY_PROVISIONING_CONFLICT",
          "AYIN could not allocate the creator identity safely.",
        );
      }
      throw error;
    }
  }

  async login(
    input: LoginInput,
    metadata: SessionRequestMetadata,
  ): Promise<SessionResult | MfaLoginResult> {
    const email = normalizeEmail(input.email);
    const account = await this.database.client.account.findUnique({
      where: { email },
      select: {
        authVersion: true,
        id: true,
        passwordHash: true,
        status: true,
      },
    });

    if (
      !account ||
      account.status !== "ACTIVE" ||
      !account.passwordHash ||
      !(await this.passwordService.verify(input.password, account.passwordHash))
    ) {
      throw unauthorized("Email or password is incorrect.");
    }

    const challenge = await this.mfa.loginChallenge(account.id, account.authVersion);
    if (challenge) return challenge;
    return {
      token: await this.sessions.create(
        account.id,
        account.authVersion,
        {
          reauthAt: Math.floor(Date.now() / 1_000),
        },
        metadata,
      ),
      user: await this.getCurrentIdentity(account.id),
    };
  }

  async authenticate(token: string): Promise<{
    accountId: string;
    authVersion: number;
    mfaAt?: number;
    mfaVersion?: number;
    reauthAt?: number;
    sessionId: string;
  }> {
    const payload = this.tokenService.verifySession(token);
    if (!payload) {
      throw unauthorized();
    }

    const session = await this.sessions.authenticate(payload);

    return {
      accountId: payload.sub,
      authVersion: payload.av,
      sessionId: session.sessionId,
      ...(payload.mfaAt ? { mfaAt: payload.mfaAt } : {}),
      ...(payload.mv !== undefined ? { mfaVersion: payload.mv } : {}),
      ...(payload.reauthAt ? { reauthAt: payload.reauthAt } : {}),
    };
  }

  async completeMfaChallenge(
    challengeToken: string,
    input: { code?: string; recoveryCode?: string },
    metadata: SessionRequestMetadata,
  ): Promise<SessionResult> {
    const assurance = await this.mfa.verifyChallenge(
      challengeToken,
      input.code,
      input.recoveryCode,
    );
    return {
      token: await this.sessions.create(
        assurance.accountId,
        assurance.authVersion,
        assurance,
        metadata,
      ),
      user: await this.getCurrentIdentity(assurance.accountId),
    };
  }

  async completeMfaEnrollment(
    enrollmentToken: string,
    code: string,
    metadata: SessionRequestMetadata,
  ): Promise<SessionResult> {
    const assurance = await this.mfa.confirmEnrollment(enrollmentToken, code);
    return {
      token: await this.sessions.create(
        assurance.accountId,
        assurance.authVersion,
        assurance,
        metadata,
      ),
      user: await this.getCurrentIdentity(assurance.accountId),
      ...(assurance.recoveryCodes ? { recoveryCodes: assurance.recoveryCodes } : {}),
    };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }
    await this.sessions.logout(this.tokenService.verifySession(token));
  }

  async requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
    const email = normalizeEmail(input.email);
    const account = await this.database.client.account.findUnique({
      where: { email },
      select: { authVersion: true, email: true, id: true, status: true },
    });

    if (!account || account.status !== "ACTIVE" || !this.emailAdapter.configured) {
      return;
    }

    const token = this.tokenService.issuePasswordReset(account.id, account.authVersion);
    const resetUrl = new URL("/reset-password", this.config.webOrigin);
    resetUrl.searchParams.set("token", token);

    try {
      await this.emailAdapter.sendPasswordReset({
        email: account.email,
        resetUrl: resetUrl.toString(),
      });
    } catch {
      throw new AuthHttpError(
        503,
        "EMAIL_DELIVERY_FAILED",
        "Password reset email could not be delivered.",
      );
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const payload = this.tokenService.verifyPasswordReset(input.token);
    if (!payload) {
      throw unauthorized("This password reset link is invalid or expired.");
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const result = await this.database.client.$transaction(async (tx) => {
      const updated = await tx.account.updateMany({
        where: {
          authVersion: payload.av,
          id: payload.sub,
          status: "ACTIVE",
        },
        data: {
          authVersion: { increment: 1 },
          passwordHash,
        },
      });
      if (updated.count === 1) {
        await tx.accountSession.updateMany({
          where: { accountId: payload.sub, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "PASSWORD_RESET" },
        });
      }
      return updated;
    });

    if (result.count !== 1) {
      throw unauthorized("This password reset link is invalid or expired.");
    }
  }

  async changePassword(accountId: string, currentSessionId: string, input: ChangePasswordInput) {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { passwordHash: true, status: true },
    });
    if (
      !account ||
      account.status !== "ACTIVE" ||
      !account.passwordHash ||
      !(await this.passwordService.verify(input.currentPassword, account.passwordHash))
    ) {
      throw unauthorized("The current password is incorrect.");
    }
    const passwordHash = await this.passwordService.hash(input.newPassword);
    const revoked = await this.database.client.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: { passwordHash } });
      if (!input.revokeOtherSessions) return 0;
      const result = await tx.accountSession.updateMany({
        where: { accountId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" },
      });
      return result.count;
    });
    return { changed: true, otherSessionsRevoked: revoked };
  }

  async getCurrentIdentity(accountId: string): Promise<PublicIdentity> {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: {
        displayName: true,
        email: true,
        id: true,
        viewerProfiles: {
          where: { deletedAt: null, isDefault: true },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, name: true, slug: true },
        },
        channelMemberships: {
          where: { role: "OWNER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            channel: {
              select: {
                handle: true,
                id: true,
                name: true,
                primaryTvChannel: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        },
      },
    });

    const profile = account?.viewerProfiles[0];
    const channel = account?.channelMemberships[0]?.channel;
    if (!account || !profile || !channel || !channel.primaryTvChannel) {
      throw new AuthHttpError(
        500,
        "IDENTITY_NOT_PROVISIONED",
        "The AYIN creator identity is incomplete.",
      );
    }

    return {
      account: { displayName: account.displayName, email: account.email, id: account.id },
      channel: { handle: channel.handle, id: channel.id, name: channel.name },
      creatorTv: channel.primaryTvChannel,
      profile,
    };
  }
}
