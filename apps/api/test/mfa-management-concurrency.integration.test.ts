import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "../src/auth/auth.config.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { MfaCryptoService } from "../src/auth/mfa-crypto.service.js";
import { MfaService } from "../src/auth/mfa.service.js";
import { PasswordService } from "../src/auth/password.service.js";
import { generateTotpCode, generateTotpSecret, totpCounter } from "../src/auth/totp.js";
import type { DatabaseService } from "../src/database/database.service.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
databaseDescribe("MFA management concurrency", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const config = { tokenSecret: "mfa-management-test-secret-not-for-production" } as AuthConfig;
  const tokens = new AuthTokenService(config);
  const crypto = new MfaCryptoService(config);
  const passwords = new PasswordService();
  const password = "mfa-management-test-password";
  let passwordHash: string;
  const makeService = (client: unknown = prisma) =>
    new MfaService({ client } as DatabaseService, tokens, crypto, passwords, {} as never);
  beforeAll(async () => {
    passwordHash = await passwords.hash(password);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "AdminRoleAssignment" CASCADE');
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "AdminRoleAssignment" CASCADE');
    await prisma.$disconnect();
  });
  async function fixture() {
    const account = await prisma.account.create({
      data: {
        email: `${randomUUID()}@mfa.test.invalid`,
        displayName: "MFA management",
        passwordHash,
      },
    });
    const secret = generateTotpSecret();
    const credential = await prisma.accountMfaCredential.create({
      data: {
        accountId: account.id,
        status: "ENABLED",
        version: 1,
        encryptedSecret: crypto.encrypt(secret),
        pendingExpiresAt: new Date(),
        enabledAt: new Date(),
        recoveryCodeHashes: [crypto.hashRecoveryCode("AAAA-BBBB-CCCC-DDDD")],
      },
    });
    return { account, credential, code: generateTotpCode(secret, totpCounter()) };
  }
  function pausedCredentialRead() {
    const selected = gate(),
      proceed = gate();
    const client = prisma.$extends({
      query: {
        accountMfaCredential: {
          findUnique: async ({ args, query }) => {
            const value = await query(args);
            selected.open();
            await proceed.promise;
            return value;
          },
        },
      },
    });
    return { selected, proceed, service: makeService(client) };
  }
  const operations = ["regenerate", "disable"] as const;
  function manage(
    service: MfaService,
    operation: (typeof operations)[number],
    accountId: string,
    code: string,
  ) {
    return operation === "regenerate"
      ? service.regenerateRecoveryCodes(accountId, password, code)
      : service.disable(accountId, password, code);
  }
  for (const operation of operations) {
    it.each(["credential", "accountVersion"] as const)(
      `rejects ${operation} after %s changes and preserves the current credential`,
      async (change) => {
        const { account, code } = await fixture();
        const { service, selected, proceed } = pausedCredentialRead();
        const attempt = Promise.allSettled([manage(service, operation, account.id, code)]);
        await selected.promise;
        let before;
        try {
          if (change === "credential")
            await prisma.accountMfaCredential.update({
              where: { accountId: account.id },
              data: { encryptedSecret: crypto.encrypt(generateTotpSecret()) },
            });
          else
            await prisma.account.update({
              where: { id: account.id },
              data: { authVersion: { increment: 1 } },
            });
          before = await prisma.accountMfaCredential.findUniqueOrThrow({
            where: { accountId: account.id },
          });
        } finally {
          proceed.open();
        }
        expect((await attempt)[0]?.status).toBe("rejected");
        expect(
          await prisma.accountMfaCredential.findUnique({ where: { accountId: account.id } }),
        ).toEqual(before);
        expect(
          (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).authVersion,
        ).toBe(change === "accountVersion" ? 1 : 0);
        expect(await prisma.adminAuditLog.count()).toBe(0);
      },
    );
    it(`rolls back the TOTP and ${operation} mutation if audit fails`, async () => {
      const { account, credential, code } = await fixture();
      const client = prisma.$extends({
        query: {
          adminAuditLog: {
            create: async () => {
              throw new Error("Audit unavailable");
            },
          },
        },
      });
      await expect(manage(makeService(client), operation, account.id, code)).rejects.toThrow(
        "Audit unavailable",
      );
      expect(
        await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
      ).toEqual(credential);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).authVersion,
      ).toBe(0);
      expect(await prisma.adminAuditLog.count()).toBe(0);
      await expect(manage(makeService(), operation, account.id, code)).resolves.toBeDefined();
    });
  }
  it("rejects disable when an administrator role is assigned after the initial policy check", async () => {
    const { account, credential, code } = await fixture();
    const { service, selected, proceed } = pausedCredentialRead();
    const attempt = Promise.allSettled([service.disable(account.id, password, code)]);
    await selected.promise;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.adminRoleAssignment.create({ data: { accountId: account.id, role: "ADMIN" } });
        await tx.account.update({
          where: { id: account.id },
          data: { authVersion: { increment: 1 } },
        });
      });
    } finally {
      proceed.open();
    }
    expect((await attempt)[0]?.status).toBe("rejected");
    expect(
      await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
    ).toEqual(credential);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });
  it.each(["status", "secret"] as const)(
    "rejects TOTP challenge after credential %s changes",
    async (change) => {
      const { account, code } = await fixture();
      const { service, selected, proceed } = pausedCredentialRead();
      const token = tokens.issueMfaChallenge(account.id, account.authVersion, 1, "verify");
      const attempt = Promise.allSettled([service.verifyChallenge(token, code)]);
      await selected.promise;
      let before;
      try {
        before = await prisma.accountMfaCredential.update({
          where: { accountId: account.id },
          data:
            change === "status"
              ? { status: "PENDING" }
              : { encryptedSecret: crypto.encrypt(generateTotpSecret()) },
        });
      } finally {
        proceed.open();
      }
      expect((await attempt)[0]?.status).toBe("rejected");
      expect(
        await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
      ).toEqual(before);
    },
  );
  it("rejects reset after the acting superadmin is demoted", async () => {
    const { account, credential } = await fixture();
    const actor = await prisma.account.create({
      data: { email: `${randomUUID()}@mfa.test.invalid`, displayName: "Reset operator" },
    });
    await prisma.adminRoleAssignment.create({ data: { accountId: actor.id, role: "SUPERADMIN" } });
    // A remaining superadmin makes demotion of the acting operator a valid
    // staff-governance transition, rather than an impossible last-admin removal.
    const remaining = await prisma.account.create({
      data: { email: `${randomUUID()}@mfa.test.invalid`, displayName: "Remaining superadmin" },
    });
    await prisma.adminRoleAssignment.create({
      data: { accountId: remaining.id, role: "SUPERADMIN" },
    });
    const selected = gate(),
      proceed = gate();
    const client = prisma.$extends({
      query: {
        account: {
          findUnique: async ({ args, query }) => {
            const value = await query(args);
            if (args.where.id === account.id) {
              selected.open();
              await proceed.promise;
            }
            return value;
          },
        },
      },
    });
    const attempt = Promise.allSettled([
      makeService(client).resetBySuperadmin(actor.id, account.id, "Reviewed MFA recovery request"),
    ]);
    await selected.promise;
    try {
      await prisma.adminRoleAssignment.deleteMany({ where: { accountId: actor.id } });
    } finally {
      proceed.open();
    }
    expect((await attempt)[0]?.status).toBe("rejected");
    expect(
      await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
    ).toEqual(credential);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).authVersion,
    ).toBe(0);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });
});
