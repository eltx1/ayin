import { createHmac, randomBytes } from "node:crypto";

import { createPrismaClient } from "../../packages/db/dist/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e") {
  throw new Error("Recovery fixture requires isolated local ayin_e2e");
}
const [command, accountId] = process.argv.slice(2);
const prisma = createPrismaClient(databaseUrl);
try {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { id: true, email: true, authVersion: true },
  });
  if (!account.email.endsWith("@e2e.ayin.test")) {
    throw new Error("Recovery fixture only accepts synthetic E2E accounts");
  }
  if (command === "token") {
    // Match the public test server's password-reset token contract. This key is
    // deliberately synthetic and cannot issue tokens for any live AYIN account.
    const now = Math.floor(Date.now() / 1000);
    const encoded = Buffer.from(
      JSON.stringify({
        av: account.authVersion,
        exp: now + 1800,
        iat: now,
        nonce: randomBytes(18).toString("base64url"),
        purpose: "password-reset",
        sub: account.id,
        v: 1,
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
      .update(encoded)
      .digest("base64url");
    process.stdout.write(JSON.stringify({ token: `v1.${encoded}.${signature}` }));
  } else if (command === "state") {
    const sessions = await prisma.accountSession.findMany({
      where: { accountId },
      select: { revokedAt: true, revokeReason: true },
    });
    process.stdout.write(JSON.stringify({ authVersion: account.authVersion, sessions }));
  } else {
    throw new Error("Unknown recovery fixture command");
  }
} finally {
  await prisma.$disconnect();
}
