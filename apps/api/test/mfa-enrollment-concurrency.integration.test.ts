import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "../src/auth/auth.config.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { MfaCryptoService } from "../src/auth/mfa-crypto.service.js";
import { MfaService } from "../src/auth/mfa.service.js";
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
databaseDescribe("MFA enrollment concurrency", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const config = { tokenSecret: "mfa-enrollment-test-secret-not-for-production" } as AuthConfig;
  const tokens = new AuthTokenService(config);
  const crypto = new MfaCryptoService(config);
  const makeService = (client: unknown = prisma) =>
    new MfaService({ client } as DatabaseService, tokens, crypto, {} as never, {} as never);
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.$disconnect();
  });
  async function fixture() {
    const account = await prisma.account.create({
      data: { email: `${randomUUID()}@mfa.test.invalid`, displayName: "Enrollment concurrency" },
    });
    return {
      account,
      challenge: tokens.issueMfaChallenge(account.id, account.authVersion, 0, "enroll"),
    };
  }
  function pausedReads(count: number) {
    const selected = gate(),
      proceed = gate();
    let reads = 0;
    const client = prisma.$extends({
      query: {
        accountMfaCredential: {
          findUnique: async ({ args, query }) => {
            const value = await query(args);
            if (++reads <= count) {
              if (reads === count) selected.open();
              await proceed.promise;
            }
            return value;
          },
        },
      },
    });
    return { selected, proceed, service: makeService(client) };
  }
  it("does not overwrite an enrollment confirmed after a restart read", async () => {
    const { account, challenge } = await fixture();
    const enrollment = await makeService().beginEnrollmentFromChallenge(challenge);
    const { service, selected, proceed } = pausedReads(1);
    const delayed = Promise.allSettled([service.beginEnrollmentFromChallenge(challenge)]);
    await selected.promise;
    let enabled;
    try {
      await makeService().confirmEnrollment(
        enrollment.enrollmentToken,
        generateTotpCode(enrollment.secret, totpCounter()),
      );
      enabled = await prisma.accountMfaCredential.findUniqueOrThrow({
        where: { accountId: account.id },
      });
    } finally {
      proceed.open();
    }
    expect((await delayed)[0]?.status).toBe("rejected");
    expect(
      await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
    ).toEqual(enabled);
    expect(
      await prisma.adminAuditLog.count({ where: { action: "auth.mfa_enrollment_started" } }),
    ).toBe(1);
  });
  it.each([false, true])(
    "only one start commits from the same snapshot (existing pending: %s)",
    async (existing) => {
      const { account, challenge } = await fixture();
      if (existing) await makeService().beginEnrollmentFromChallenge(challenge);
      const { service, selected, proceed } = pausedReads(2);
      const attempts = Promise.allSettled([
        service.beginEnrollmentFromChallenge(challenge),
        service.beginEnrollmentFromChallenge(challenge),
      ]);
      await selected.promise;
      proceed.open();
      const results = await attempts;
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      const winner = results.find((result) => result.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw new Error("No accepted enrollment");
      const stored = await prisma.accountMfaCredential.findUniqueOrThrow({
        where: { accountId: account.id },
      });
      expect(crypto.decrypt(stored.encryptedSecret)).toBe(winner.value.secret);
      expect(stored.version).toBe(existing ? 2 : 1);
      expect(
        await prisma.adminAuditLog.count({ where: { action: "auth.mfa_enrollment_started" } }),
      ).toBe(existing ? 2 : 1);
    },
  );
  it.each(["secret", "accountVersion"] as const)(
    "rejects confirmation after %s changes without enabling or auditing",
    async (change) => {
      const { account, challenge } = await fixture();
      const enrollment = await makeService().beginEnrollmentFromChallenge(challenge);
      const { service, selected, proceed } = pausedReads(1);
      const attempt = Promise.allSettled([
        service.confirmEnrollment(
          enrollment.enrollmentToken,
          generateTotpCode(enrollment.secret, totpCounter()),
        ),
      ]);
      await selected.promise;
      let before;
      try {
        if (change === "secret")
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
        await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
      ).toEqual(before);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).authVersion,
      ).toBe(change === "accountVersion" ? 1 : 0);
      expect(await prisma.adminAuditLog.count({ where: { action: "auth.mfa_enabled" } })).toBe(0);
    },
  );
  it("rolls back a pending restart when its audit fails", async () => {
    const { account, challenge } = await fixture();
    await makeService().beginEnrollmentFromChallenge(challenge);
    const before = await prisma.accountMfaCredential.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    const client = prisma.$extends({
      query: {
        adminAuditLog: {
          create: async () => {
            throw new Error("Audit unavailable");
          },
        },
      },
    });
    await expect(makeService(client).beginEnrollmentFromChallenge(challenge)).rejects.toThrow(
      "Audit unavailable",
    );
    expect(
      await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }),
    ).toEqual(before);
    expect(await prisma.adminAuditLog.count()).toBe(1);
  });
});
