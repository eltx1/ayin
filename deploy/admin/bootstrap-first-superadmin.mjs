#!/usr/bin/env node

import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { createInterface } from "node:readline";

import { createPrismaClient } from "../../packages/db/dist/index.js";

const apiEnvPath = process.env.AYIN_API_ENV_PATH ?? "/home/ayin/env/api.env";
const expectedHome = "/home/ayin";
const advisoryLockId = 86192026;

function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

function parseEnvFile(path) {
  const values = new Map();
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1));
  }
  return values;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function maskedEmail(value) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

async function prompt(question) {
  const input = createReadStream("/dev/tty");
  const output = createWriteStream("/dev/tty");
  const terminal = createInterface({ input, output, terminal: true });
  try {
    return await new Promise((resolve) => terminal.question(question, resolve));
  } finally {
    terminal.close();
    input.destroy();
    output.end();
  }
}

async function main() {
  if (userInfo().username !== "ayin" || process.env.HOME !== expectedHome) {
    throw new Error("run this bootstrap only as the dedicated 'ayin' Linux user with HOME=/home/ayin");
  }

  const env = parseEnvFile(apiEnvPath);
  const databaseUrl = env.get("DATABASE_URL");
  if (env.get("APP_ENV") !== "production" || env.get("NODE_ENV") !== "production") {
    throw new Error("AYIN api.env is not a production environment");
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is missing from AYIN api.env");

  const parsedUrl = new URL(databaseUrl);
  if (
    parsedUrl.protocol !== "postgresql:" ||
    parsedUrl.hostname !== "127.0.0.1" ||
    parsedUrl.port !== "5432" ||
    parsedUrl.pathname !== "/ayin"
  ) {
    throw new Error("bootstrap refuses a database outside the local AYIN production database");
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const existingSuperadmins = await prisma.adminRoleAssignment.count({
      where: { role: "SUPERADMIN" },
    });
    if (existingSuperadmins > 0) {
      throw new Error(
        "a SUPERADMIN already exists; this one-time bootstrap is permanently disabled for normal use",
      );
    }

    const email = normalizeEmail(await prompt("Existing AYIN account email to promote: "));
    if (!email || !email.includes("@")) {
      throw new Error("a valid existing AYIN account email is required");
    }

    const account = await prisma.account.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        viewerProfiles: { select: { id: true }, take: 1 },
        channelMemberships: {
          where: { role: "OWNER" },
          select: { channelId: true },
          take: 1,
        },
      },
    });

    if (!account) {
      throw new Error("no AYIN account exists with that email; register through ayin.stream first");
    }
    if (account.status !== "ACTIVE") throw new Error("the target AYIN account is not ACTIVE");
    if (account.viewerProfiles.length !== 1 || account.channelMemberships.length !== 1) {
      throw new Error(
        "the target account does not have the normal viewer/creator identity; bootstrap will not promote a partial account",
      );
    }

    console.log(`Target: ${account.displayName} (${maskedEmail(account.email)})`);
    const confirmation = (
      await prompt("Type PROMOTE to create the first production SUPERADMIN: ")
    ).trim();
    if (confirmation !== "PROMOTE") {
      throw new Error("bootstrap cancelled; confirmation did not match");
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${advisoryLockId})`);

      const count = await tx.adminRoleAssignment.count({ where: { role: "SUPERADMIN" } });
      if (count > 0) {
        throw new Error("another SUPERADMIN was created before this transaction completed");
      }

      await tx.adminRoleAssignment.create({
        data: { accountId: account.id, role: "SUPERADMIN" },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId: account.id,
          action: "ADMIN_ROLE_BOOTSTRAP",
          entityType: "Account",
          entityId: account.id,
          reason: "Initial production SUPERADMIN bootstrap",
          metadata: {
            role: "SUPERADMIN",
            method: "one-time-server-bootstrap",
          },
        },
      });
    });

    console.log("AYIN first production SUPERADMIN created successfully.");
    console.log(`Account: ${maskedEmail(account.email)}`);
    console.log("The bootstrap will refuse future use while any SUPERADMIN exists.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "SUPERADMIN bootstrap failed");
});
