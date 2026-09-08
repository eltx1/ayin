import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import QRCode from "qrcode";
import type { Prisma } from "@ayin/db";

import { DatabaseService } from "../database/database.service.js";
import { badRequest, conflict, unauthorized } from "./auth.errors.js";
import { AuthTokenService, type AuthTokenPayload } from "./auth-token.service.js";
import { MfaCryptoService } from "./mfa-crypto.service.js";
import { PasswordService } from "./password.service.js";
import {
  buildTotpProvisioningUri,
  encodeBase32,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";

const privilegedRoles = new Set(["SUPERADMIN", "ADMIN"]);
const pendingTtlMs = 10 * 60 * 1_000;

interface Assurance {
  accountId: string;
  authVersion: number;
  mfaAt: number;
  mfaVersion: number;
  reauthAt: number;
  recoveryCodes?: string[];
}

@Injectable()
export class MfaService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(MfaCryptoService) private readonly crypto: MfaCryptoService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async loginChallenge(accountId: string, authVersion: number) {
    const [roles, credential] = await Promise.all([
      this.database.client.adminRoleAssignment.findMany({
        where: { accountId },
        select: { role: true },
      }),
      this.database.client.accountMfaCredential.findUnique({ where: { accountId } }),
    ]);
    const required = roles.some(({ role }) => privilegedRoles.has(role));
    if (!required && credential?.status !== "ENABLED") return null;
    const enrollmentRequired = credential?.status !== "ENABLED";
    return {
      mfaRequired: true as const,
      enrollmentRequired,
      challengeToken: this.tokens.issueMfaChallenge(
        accountId,
        authVersion,
        credential?.version ?? 0,
        enrollmentRequired ? "enroll" : "verify",
      ),
    };
  }

  challengeSubject(token: string, intent: "enroll" | "verify"): string {
    const payload = this.tokens.verifyMfaChallenge(token);
    return payload?.intent === intent ? payload.sub : "invalid";
  }

  enrollmentSubject(token: string): string {
    return this.tokens.verifyMfaEnrollment(token)?.sub ?? "invalid";
  }

  async status(accountId: string) {
    const [credential, roles] = await Promise.all([
      this.database.client.accountMfaCredential.findUnique({
        where: { accountId },
        select: { status: true, enabledAt: true, recoveryCodeHashes: true },
      }),
      this.database.client.adminRoleAssignment.findMany({
        where: { accountId },
        select: { role: true },
      }),
    ]);
    return {
      enabled: credential?.status === "ENABLED",
      required: roles.some(({ role }) => privilegedRoles.has(role)),
      enabledAt: credential?.status === "ENABLED" ? credential.enabledAt : null,
      recoveryCodesRemaining:
        credential?.status === "ENABLED" ? credential.recoveryCodeHashes.length : 0,
    };
  }

  async beginEnrollmentFromChallenge(challengeToken: string) {
    const payload = this.tokens.verifyMfaChallenge(challengeToken);
    if (!payload || payload.intent !== "enroll")
      throw unauthorized("The MFA enrollment request is invalid or expired.");
    await this.assertAccountVersion(payload);
    return this.beginEnrollment(payload.sub, payload.av);
  }

  async beginAuthenticatedEnrollment(accountId: string, password: string) {
    const account = await this.verifyPassword(accountId, password);
    return this.beginEnrollment(account.id, account.authVersion);
  }

  async confirmEnrollment(enrollmentToken: string, code: string): Promise<Assurance> {
    const payload = this.tokens.verifyMfaEnrollment(enrollmentToken);
    if (!payload || payload.mv === undefined)
      throw unauthorized("The MFA enrollment request is invalid or expired.");
    const credentialVersion = payload.mv;
    await this.assertAccountVersion(payload);
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId: payload.sub },
    });
    if (
      !credential ||
      credential.status !== "PENDING" ||
      credential.version !== credentialVersion ||
      credential.pendingExpiresAt <= new Date()
    ) {
      throw unauthorized("The MFA enrollment request is invalid or expired.");
    }
    const counter = verifyTotpCode(this.crypto.decrypt(credential.encryptedSecret), code);
    if (counter === null) throw unauthorized("The authentication code is invalid.");
    const recoveryCodes = this.generateRecoveryCodes();
    const recoveryCodeHashes = recoveryCodes.map((item) => this.crypto.hashRecoveryCode(item));
    const now = new Date();
    const updated = await this.database.client.$transaction(async (tx) => {
      const result = await tx.accountMfaCredential.updateMany({
        where: {
          accountId: payload.sub,
          status: "PENDING",
          version: credentialVersion,
          pendingExpiresAt: { gt: now },
        },
        data: {
          status: "ENABLED",
          enabledAt: now,
          lastUsedCounter: counter,
          recoveryCodeHashes,
          recoveryCodesGeneratedAt: now,
        },
      });
      if (result.count !== 1) return false;
      await this.audit(tx, payload.sub, "auth.mfa_enabled", payload.sub, {
        recoveryCodeCount: recoveryCodes.length,
      });
      return true;
    });
    if (!updated)
      throw conflict(
        "MFA_ENROLLMENT_CHANGED",
        "MFA enrollment changed before verification completed.",
      );
    const epoch = Math.floor(now.getTime() / 1_000);
    return {
      accountId: payload.sub,
      authVersion: payload.av,
      mfaAt: epoch,
      mfaVersion: payload.mv,
      reauthAt: epoch,
      recoveryCodes,
    };
  }

  async verifyChallenge(
    challengeToken: string,
    code?: string,
    recoveryCode?: string,
  ): Promise<Assurance> {
    const payload = this.tokens.verifyMfaChallenge(challengeToken);
    if (!payload || payload.intent !== "verify")
      throw unauthorized("The MFA challenge is invalid or expired.");
    await this.assertAccountVersion(payload);
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId: payload.sub },
    });
    if (!credential || credential.status !== "ENABLED" || credential.version !== payload.mv) {
      throw unauthorized("The MFA challenge is invalid or expired.");
    }
    if (code) await this.consumeTotp(credential, code);
    else if (recoveryCode) await this.consumeRecoveryCode(credential, recoveryCode);
    else throw badRequest("MFA_CODE_REQUIRED", "Enter an authenticator or recovery code.");
    const epoch = Math.floor(Date.now() / 1_000);
    return {
      accountId: payload.sub,
      authVersion: payload.av,
      mfaAt: epoch,
      mfaVersion: credential.version,
      reauthAt: epoch,
    };
  }

  async stepUp(accountId: string, password: string, code?: string) {
    const account = await this.verifyPassword(accountId, password);
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId },
    });
    let mfaAt: number | undefined;
    let mfaVersion: number | undefined;
    if (credential?.status === "ENABLED") {
      if (!code) throw badRequest("MFA_CODE_REQUIRED", "Enter an authenticator code.");
      await this.consumeTotp(credential, code);
      mfaAt = Math.floor(Date.now() / 1_000);
      mfaVersion = credential.version;
    } else if (await this.isPrivileged(accountId)) {
      throw conflict(
        "MFA_ENROLLMENT_REQUIRED",
        "MFA enrollment is required for this administrator.",
      );
    }
    const reauthAt = Math.floor(Date.now() / 1_000);
    return {
      token: this.tokens.issueSession(accountId, account.authVersion, {
        reauthAt,
        ...(mfaAt ? { mfaAt } : {}),
        ...(mfaVersion !== undefined ? { mfaVersion } : {}),
      }),
    };
  }

  async regenerateRecoveryCodes(accountId: string, password: string, code: string) {
    await this.verifyPassword(accountId, password);
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId },
    });
    if (!credential || credential.status !== "ENABLED")
      throw conflict("MFA_NOT_ENABLED", "MFA is not enabled.");
    await this.consumeTotp(credential, code);
    const recoveryCodes = this.generateRecoveryCodes();
    await this.database.client.$transaction(async (tx) => {
      await tx.accountMfaCredential.update({
        where: { accountId },
        data: {
          recoveryCodeHashes: recoveryCodes.map((item) => this.crypto.hashRecoveryCode(item)),
          recoveryCodesGeneratedAt: new Date(),
        },
      });
      await this.audit(tx, accountId, "auth.mfa_recovery_codes_regenerated", accountId, {
        recoveryCodeCount: recoveryCodes.length,
      });
    });
    return { recoveryCodes };
  }

  async disable(accountId: string, password: string, code: string) {
    if (await this.isPrivileged(accountId)) {
      throw conflict(
        "MFA_REQUIRED_BY_POLICY",
        "MFA cannot be disabled while this account has an administrator role.",
      );
    }
    await this.verifyPassword(accountId, password);
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId },
    });
    if (!credential || credential.status !== "ENABLED")
      throw conflict("MFA_NOT_ENABLED", "MFA is not enabled.");
    await this.consumeTotp(credential, code);
    await this.database.client.$transaction(async (tx) => {
      await tx.accountMfaCredential.delete({ where: { accountId } });
      await tx.account.update({
        where: { id: accountId },
        data: { authVersion: { increment: 1 } },
      });
      await this.audit(tx, accountId, "auth.mfa_disabled", accountId);
    });
    return { disabled: true };
  }

  async resetBySuperadmin(actorAccountId: string, targetAccountId: string, reason: string) {
    if (actorAccountId === targetAccountId)
      throw badRequest("SELF_MFA_RESET_BLOCKED", "A superadmin cannot reset their own MFA.");
    const target = await this.database.client.account.findUnique({
      where: { id: targetAccountId },
      select: { id: true },
    });
    if (!target) throw badRequest("MFA_ACCOUNT_NOT_FOUND", "The target account was not found.");
    await this.database.client.$transaction(async (tx) => {
      await tx.accountMfaCredential.deleteMany({ where: { accountId: targetAccountId } });
      await tx.account.update({
        where: { id: targetAccountId },
        data: { authVersion: { increment: 1 } },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "admin.mfa_reset",
          entityType: "Account",
          entityId: targetAccountId,
          reason,
          metadata: { sessionsRevoked: true },
        },
      });
    });
    return { reset: true, sessionsRevoked: true };
  }

  async assertAdminMfa(accountId: string, mfaAt?: number, mfaVersion?: number) {
    if (!mfaAt || mfaVersion === undefined)
      throw unauthorized("Administrator MFA verification is required.");
    const credential = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId },
      select: { status: true, version: true },
    });
    if (!credential || credential.status !== "ENABLED" || credential.version !== mfaVersion) {
      throw unauthorized("Administrator MFA verification is required.");
    }
  }

  private async beginEnrollment(accountId: string, authVersion: number) {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (!account) throw unauthorized();
    const existing = await this.database.client.accountMfaCredential.findUnique({
      where: { accountId },
    });
    if (existing?.status === "ENABLED")
      throw conflict("MFA_ALREADY_ENABLED", "MFA is already enabled.");
    const secret = generateTotpSecret();
    const version = (existing?.version ?? 0) + 1;
    const pendingExpiresAt = new Date(Date.now() + pendingTtlMs);
    await this.database.client.$transaction(async (tx) => {
      await tx.accountMfaCredential.upsert({
        where: { accountId },
        create: {
          accountId,
          encryptedSecret: this.crypto.encrypt(secret),
          version,
          pendingExpiresAt,
        },
        update: {
          encryptedSecret: this.crypto.encrypt(secret),
          status: "PENDING",
          version,
          pendingExpiresAt,
          enabledAt: null,
          lastUsedCounter: null,
          recoveryCodeHashes: [],
          recoveryCodesGeneratedAt: null,
        },
      });
      await this.audit(tx, accountId, "auth.mfa_enrollment_started", accountId);
    });
    const provisioningUri = buildTotpProvisioningUri(account.email, secret);
    return {
      secret,
      provisioningUri,
      qrCodeDataUrl: await QRCode.toDataURL(provisioningUri, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      }),
      enrollmentToken: this.tokens.issueMfaEnrollment(accountId, authVersion, version),
      expiresAt: pendingExpiresAt.toISOString(),
    };
  }

  private async consumeTotp(
    credential: {
      accountId: string;
      encryptedSecret: string;
      lastUsedCounter: bigint | null;
      version: number;
    },
    code: string,
  ) {
    const counter = verifyTotpCode(this.crypto.decrypt(credential.encryptedSecret), code);
    if (
      counter === null ||
      (credential.lastUsedCounter !== null && counter <= credential.lastUsedCounter)
    ) {
      throw unauthorized("The authentication code is invalid or was already used.");
    }
    const result = await this.database.client.accountMfaCredential.updateMany({
      where: {
        accountId: credential.accountId,
        version: credential.version,
        OR: [{ lastUsedCounter: null }, { lastUsedCounter: { lt: counter } }],
      },
      data: { lastUsedCounter: counter },
    });
    if (result.count !== 1)
      throw unauthorized("The authentication code is invalid or was already used.");
  }

  private async consumeRecoveryCode(
    credential: { accountId: string; recoveryCodeHashes: string[]; version: number },
    code: string,
  ) {
    const match = credential.recoveryCodeHashes.find((hash) =>
      this.crypto.verifyRecoveryCode(code, hash),
    );
    if (!match) throw unauthorized("The recovery code is invalid or was already used.");
    const remaining = credential.recoveryCodeHashes.filter((hash) => hash !== match);
    const used = await this.database.client.$transaction(async (tx) => {
      const result = await tx.accountMfaCredential.updateMany({
        where: {
          accountId: credential.accountId,
          version: credential.version,
          recoveryCodeHashes: { has: match },
        },
        data: { recoveryCodeHashes: remaining },
      });
      if (result.count !== 1) return false;
      await this.audit(
        tx,
        credential.accountId,
        "auth.mfa_recovery_code_used",
        credential.accountId,
        {
          recoveryCodesRemaining: remaining.length,
        },
      );
      return true;
    });
    if (!used) throw unauthorized("The recovery code is invalid or was already used.");
  }

  private async verifyPassword(accountId: string, password: string) {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { id: true, authVersion: true, passwordHash: true, status: true },
    });
    if (
      !account ||
      account.status !== "ACTIVE" ||
      !account.passwordHash ||
      !(await this.passwords.verify(password, account.passwordHash))
    ) {
      throw unauthorized("The current password is incorrect.");
    }
    return account;
  }

  private async assertAccountVersion(payload: AuthTokenPayload) {
    const count = await this.database.client.account.count({
      where: { id: payload.sub, authVersion: payload.av, status: "ACTIVE" },
    });
    if (count !== 1) throw unauthorized("The MFA request is invalid or expired.");
  }

  private async isPrivileged(accountId: string) {
    return (
      (await this.database.client.adminRoleAssignment.count({
        where: { accountId, role: { in: [...privilegedRoles] } },
      })) > 0
    );
  }

  private generateRecoveryCodes() {
    return Array.from({ length: 10 }, () => {
      const value = encodeBase32(randomBytes(10));
      return value.match(/.{1,4}/g)!.join("-");
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    actorAccountId: string,
    action: string,
    entityId: string,
    metadata?: Record<string, string | number | boolean>,
  ) {
    return tx.adminAuditLog.create({
      data: {
        actorAccountId,
        action,
        entityType: "AccountMfaCredential",
        entityId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}
