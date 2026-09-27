import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "../src/auth/auth.config.js";
import { AuthTokenService } from "../src/auth/auth-token.service.js";
import { MfaCryptoService } from "../src/auth/mfa-crypto.service.js";
import { MfaService } from "../src/auth/mfa.service.js";
import type { DatabaseService } from "../src/database/database.service.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
databaseDescribe("MFA recovery concurrency", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const config = { tokenSecret: "mfa-concurrency-test-secret-not-for-production" } as AuthConfig;
  const tokens = new AuthTokenService(config);
  const crypto = new MfaCryptoService(config);
  const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH", "JJJJ-KKKK-LLLL-MMMM"];
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
      data: { email: `${randomUUID()}@mfa.test.invalid`, displayName: "Recovery concurrency" },
    });
    await prisma.accountMfaCredential.create({
      data: {
        accountId: account.id,
        status: "ENABLED",
        version: 1,
        encryptedSecret: crypto.encrypt("test-secret"),
        pendingExpiresAt: new Date(),
        enabledAt: new Date(),
        recoveryCodeHashes: codes.map((code) => crypto.hashRecoveryCode(code)),
      },
    });
    return {
      account,
      token: tokens.issueMfaChallenge(account.id, account.authVersion, 1, "verify"),
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
  it("consumes concurrent different codes without restoring either and audits committed counts", async () => {
    const { account, token } = await fixture();
    const { service, selected, proceed } = pausedReads(2);
    const results = Promise.allSettled(
      codes.slice(0, 2).map((code) => service.verifyChallenge(token, undefined, code)),
    );
    await selected.promise;
    proceed.open();
    expect((await results).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const stored = await prisma.accountMfaCredential.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(stored.recoveryCodeHashes).toEqual([crypto.hashRecoveryCode(codes[2]!)]);
    const audits = await prisma.adminAuditLog.findMany({
      where: { actorAccountId: account.id, action: "auth.mfa_recovery_code_used" },
      select: { metadata: true },
    });
    expect(
      audits
        .map((row) => (row.metadata as { recoveryCodesRemaining: number }).recoveryCodesRemaining)
        .sort(),
    ).toEqual([1, 2]);
    for (const code of codes.slice(0, 2))
      await expect(makeService().verifyChallenge(token, undefined, code)).rejects.toThrow(
        "invalid or was already used",
      );
  });
  it("allows only one concurrent use of the same code", async () => {
    const { account, token } = await fixture();
    const { service, selected, proceed } = pausedReads(2);
    const results = Promise.allSettled([
      service.verifyChallenge(token, undefined, codes[0]),
      service.verifyChallenge(token, undefined, codes[0]),
    ]);
    await selected.promise;
    proceed.open();
    expect((await results).map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: account.id, action: "auth.mfa_recovery_code_used" },
      }),
    ).toBe(1);
  });
  it.each(["status", "version"] as const)(
    "rejects a credential whose %s changes after the challenge read",
    async (kind) => {
      const { account, token } = await fixture();
      const { service, selected, proceed } = pausedReads(1);
      const result = Promise.allSettled([service.verifyChallenge(token, undefined, codes[0])]);
      await selected.promise;
      try {
        await prisma.accountMfaCredential.update({
          where: { accountId: account.id },
          data: kind === "status" ? { status: "PENDING" } : { version: 2 },
        });
      } finally {
        proceed.open();
      }
      expect((await result)[0]?.status).toBe("rejected");
      expect(
        (await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }))
          .recoveryCodeHashes,
      ).toHaveLength(3);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    },
  );
  it("rolls back consumption if the transactional audit fails", async () => {
    const { account, token } = await fixture();
    const client = prisma.$extends({
      query: {
        adminAuditLog: {
          create: async () => {
            throw new Error("Audit unavailable");
          },
        },
      },
    });
    await expect(makeService(client).verifyChallenge(token, undefined, codes[0])).rejects.toThrow(
      "Audit unavailable",
    );
    expect(
      (await prisma.accountMfaCredential.findUniqueOrThrow({ where: { accountId: account.id } }))
        .recoveryCodeHashes,
    ).toHaveLength(3);
    expect(await prisma.adminAuditLog.count()).toBe(0);
    await expect(makeService().verifyChallenge(token, undefined, codes[0])).resolves.toMatchObject({
      accountId: account.id,
    });
  });
});
