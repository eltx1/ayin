import "reflect-metadata";
import { randomUUID } from "node:crypto";

import { createPrismaClient, Prisma } from "@ayin/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { parseMoneyMicros } from "../src/revenue/money.js";
import { RevenueReconciliationService } from "../src/revenue/revenue-reconciliation.service.js";
import { ManualRevenueReportingAdapter } from "../src/revenue/revenue-reporting.adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe("Revenue report concurrency against isolated PostgreSQL", () => {
  const prisma = createPrismaClient(databaseUrl);
  const database = { client: prisma } as DatabaseService;
  const service = new RevenueReconciliationService(
    database,
    new AdminAuditLogService(database),
    new ManualRevenueReportingAdapter(),
  );
  const runId = randomUUID();
  const sourcePrefix = `review-reconciliation-${runId}`;
  let accountId: string;
  let channelId: string;

  beforeAll(async () => {
    const account = await prisma.account.create({
      data: { email: `${runId}@example.com`, displayName: "Isolated finance review" },
    });
    accountId = account.id;
    const channel = await prisma.channel.create({
      data: { handle: `finance-${runId}`, name: "Isolated finance review" },
    });
    channelId = channel.id;
    await prisma.adminRoleAssignment.create({ data: { accountId, role: "FINANCE_MANAGER" } });
    await prisma.creatorContract.create({
      data: { channelId, status: "ACTIVE", revenueShareBps: 6000 },
    });
    // Gate real ledger INSERTs after reconciliation has observed the previous row.
    // A fixed implementation may instead wait on its source serialization lock.
    // Both outcomes are observable as PostgreSQL lock waiters, without timing sleeps.
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ayin_test_reconciliation_insert_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."adSource" LIKE 'review-reconciliation-%' THEN
          PERFORM pg_advisory_xact_lock(9816672233);
        END IF;
        RETURN NEW;
      END $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ayin_test_reconciliation_insert_gate
      BEFORE INSERT ON "EarningsLedgerEntry" FOR EACH ROW
      EXECUTE FUNCTION ayin_test_reconciliation_insert_gate()
    `);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS ayin_test_reconciliation_insert_gate ON "EarningsLedgerEntry"',
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS ayin_test_reconciliation_insert_gate()",
    );
    await prisma.revenueSourceReport.deleteMany({
      where: { source: { startsWith: sourcePrefix } },
    });
    if (channelId) {
      await prisma.earningsLedgerEntry.deleteMany({ where: { channelId } });
      await prisma.channel.delete({ where: { id: channelId } });
    }
    if (accountId) {
      await prisma.adminAuditLog.deleteMany({ where: { actorAccountId: accountId } });
      await prisma.adminRoleAssignment.deleteMany({ where: { accountId } });
      await prisma.account.delete({ where: { id: accountId } });
    }
    await prisma.$disconnect();
  });

  function report(source: string, sourceReportId: string, grossAmount: string) {
    return {
      source,
      sourceReportId,
      periodStart: "2026-09-01T00:00:00Z",
      periodEnd: "2026-10-01T00:00:00Z",
      currency: "USD",
      state: "FINAL",
      format: "STRUCTURED",
      rows: [{ externalRowId: "same-provider-row", channelId, grossAmount }],
    };
  }

  async function concurrentReports(source: string, grossAmount: string) {
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(9816672233)::text`;
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const imports = Promise.all([
      service.importReport(accountId, report(source, "concurrent-a", grossAmount)),
      service.importReport(accountId, report(source, "concurrent-b", grossAmount)),
    ]);
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT count(*)::bigint AS "count" FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query LIKE '%INSERT INTO%"EarningsLedgerEntry"%'
              OR query LIKE '%ayin-reconciliation-source-lock%')
        `);
          expect(Number(rows[0]?.count ?? 0)).toBe(2);
        },
        { timeout: 4000, interval: 25 },
      );
    } finally {
      release();
      await holder;
    }
    return imports;
  }

  it.each([false, true])(
    "credits a provider row only once across distinct report IDs (existing row: %s)",
    async (existing) => {
      const source = `${sourcePrefix}-${existing ? "correction" : "initial"}`;
      if (existing) await service.importReport(accountId, report(source, "initial", "100.000000"));
      const results = await concurrentReports(source, existing ? "120.000000" : "100.000000");
      const entries = await prisma.earningsLedgerEntry.findMany({
        where: { channelId, adSource: source },
      });
      const credited = entries.reduce(
        (sum, entry) => sum + parseMoneyMicros(String(entry.amount)),
        0n,
      );
      expect(credited).toBe(existing ? 72_000_000n : 60_000_000n);
      expect(results.reduce((sum, result) => sum + result.duplicateRows, 0)).toBe(1);
      expect(entries).toHaveLength(existing ? 2 : 1);
    },
  );
});
