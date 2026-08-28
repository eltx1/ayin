import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AuthConfig } from "./auth.config.js";
import {
  AuthHttpError,
  conflict,
  isUniqueConstraintError,
  unauthorized,
} from "./auth.errors.js";
import { AuthTokenService } from "./auth-token.service.js";
import {
  CreatorProvisioningService,
  ProvisioningConflictError,
} from "./creator-provisioning.service.js";
import { EMAIL_ADAPTER, type EmailAdapter } from "./email.adapter.js";
import { PasswordService } from "./password.service.js";
import {
  type ForgotPasswordInput,
  type LoginInput,
  normalizeEmail,
  type RegisterInput,
  type ResetPasswordInput,
} from "./schemas.js";

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

interface SessionResult {
  token: string;
  user: PublicIdentity;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: AuthTokenService,
    private readonly provisioning: CreatorProvisioningService,
    private readonly config: AuthConfig,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
  ) {}

  async register(input: RegisterInput): Promise<SessionResult> {
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
        });

        return { account, provisioned };
      });

      return {
        token: this.tokenService.issueSession(created.account.id, created.account.authVersion),
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
        throw conflict("IDENTITY_PROVISIONING_CONFLICT", "AYIN could not allocate the creator identity safely.");
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<SessionResult> {
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

    return {
      token: this.tokenService.issueSession(account.id, account.authVersion),
      user: await this.getCurrentIdentity(account.id),
    };
  }

  async authenticate(token: string): Promise<{ accountId: string; authVersion: number }> {
    const payload = this.tokenService.verifySession(token);
    if (!payload) {
      throw unauthorized();
    }

    const account = await this.database.client.account.findUnique({
      where: { id: payload.sub },
      select: { authVersion: true, status: true },
    });
    if (!account || account.status !== "ACTIVE" || account.authVersion !== payload.av) {
      throw unauthorized();
    }

    return { accountId: payload.sub, authVersion: payload.av };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) {
      return;
    }
    const payload = this.tokenService.verifySession(token);
    if (!payload) {
      return;
    }

    await this.database.client.account.updateMany({
      where: {
        authVersion: payload.av,
        id: payload.sub,
      },
      data: { authVersion: { increment: 1 } },
    });
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
      await this.emailAdapter.sendPasswordReset({ email: account.email, resetUrl: resetUrl.toString() });
    } catch {
      throw new AuthHttpError(503, "EMAIL_DELIVERY_FAILED", "Password reset email could not be delivered.");
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const payload = this.tokenService.verifyPasswordReset(input.token);
    if (!payload) {
      throw unauthorized("This password reset link is invalid or expired.");
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const result = await this.database.client.account.updateMany({
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

    if (result.count !== 1) {
      throw unauthorized("This password reset link is invalid or expired.");
    }
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
      throw new AuthHttpError(500, "IDENTITY_NOT_PROVISIONED", "The AYIN creator identity is incomplete.");
    }

    return {
      account: { displayName: account.displayName, email: account.email, id: account.id },
      channel: { handle: channel.handle, id: channel.id, name: channel.name },
      creatorTv: channel.primaryTvChannel,
      profile,
    };
  }
}
