import { createPrismaClient, resolveDatabasePoolSettings, type PrismaClient } from "@ayin/db";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

type ConnectionSummaryRow = {
  maxConnections: number;
  total: bigint;
  active: bigint;
  idle: bigint;
  idleInTransaction: bigint;
};

type ApplicationConnectionRow = {
  applicationName: string;
  connections: bigint;
  active: bigint;
};

type ExtensionRow = { installed: boolean };

type StatementStatRow = {
  queryId: bigint;
  calls: bigint;
  totalExecMs: number;
  meanExecMs: number;
  rows: bigint;
};

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient = createPrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async postgresPerformanceSnapshot() {
    const [summaryRows, applicationRows, extensionRows] = await Promise.all([
      this.client.$queryRaw<ConnectionSummaryRow[]>`
        SELECT
          current_setting('max_connections')::int AS "maxConnections",
          COUNT(*)::bigint AS "total",
          COUNT(*) FILTER (WHERE "state" = 'active')::bigint AS "active",
          COUNT(*) FILTER (WHERE "state" = 'idle')::bigint AS "idle",
          COUNT(*) FILTER (WHERE "state" = 'idle in transaction')::bigint AS "idleInTransaction"
        FROM pg_stat_activity
        WHERE datname = current_database()
      `,
      this.client.$queryRaw<ApplicationConnectionRow[]>`
        SELECT
          COALESCE(NULLIF(application_name, ''), 'unknown') AS "applicationName",
          COUNT(*)::bigint AS "connections",
          COUNT(*) FILTER (WHERE "state" = 'active')::bigint AS "active"
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY COALESCE(NULLIF(application_name, ''), 'unknown')
        ORDER BY COUNT(*) DESC, COALESCE(NULLIF(application_name, ''), 'unknown') ASC
        LIMIT 32
      `,
      this.client.$queryRaw<ExtensionRow[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'pg_stat_statements'
        ) AS "installed"
      `,
    ]);

    const summary = summaryRows[0];
    const pgStatStatementsInstalled = extensionRows[0]?.installed === true;
    let slowStatements: Array<{
      queryId: string;
      calls: number;
      totalExecMs: number;
      meanExecMs: number;
      rows: number;
    }> = [];

    if (pgStatStatementsInstalled) {
      try {
        const rows = await this.client.$queryRaw<StatementStatRow[]>`
          SELECT
            queryid AS "queryId",
            calls::bigint AS "calls",
            total_exec_time::double precision AS "totalExecMs",
            mean_exec_time::double precision AS "meanExecMs",
            rows::bigint AS "rows"
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY total_exec_time DESC
          LIMIT 20
        `;
        slowStatements = rows.map((row) => ({
          queryId: String(row.queryId),
          calls: Number(row.calls),
          totalExecMs: Number(row.totalExecMs),
          meanExecMs: Number(row.meanExecMs),
          rows: Number(row.rows),
        }));
      } catch {
        slowStatements = [];
      }
    }

    return {
      pool: resolveDatabasePoolSettings(),
      server: {
        maxConnections: summary?.maxConnections ?? null,
        totalConnections: Number(summary?.total ?? 0n),
        activeConnections: Number(summary?.active ?? 0n),
        idleConnections: Number(summary?.idle ?? 0n),
        idleInTransactionConnections: Number(summary?.idleInTransaction ?? 0n),
        byApplication: applicationRows.map((row) => ({
          applicationName: row.applicationName,
          connections: Number(row.connections),
          active: Number(row.active),
        })),
      },
      slowStatements: {
        available: pgStatStatementsInstalled && slowStatements.length > 0,
        extensionInstalled: pgStatStatementsInstalled,
        rows: slowStatements,
        note: pgStatStatementsInstalled
          ? "Query text is intentionally omitted from the API; queryId and timing metrics identify regressions without exposing SQL literals."
          : "pg_stat_statements is optional and is not required for AYIN to run.",
      },
    };
  }
}
