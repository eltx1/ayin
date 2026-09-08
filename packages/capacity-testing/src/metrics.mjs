import { readFile } from "node:fs/promises";
import pg from "pg";

export function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  ];
}

export function summarizeResults(results, elapsedMs) {
  const latencies = results.map((result) => result.latencyMs);
  const errors = results.filter((result) => !result.ok).length;
  const failureClasses = {};
  for (const result of results.filter((item) => !item.ok)) {
    const classification = result.classification ?? "unknown";
    failureClasses[classification] = (failureClasses[classification] ?? 0) + 1;
  }
  const networkRequests = results.reduce((sum, result) => sum + (result.networkRequests ?? 1), 0);
  return {
    iterations: results.length,
    networkRequests,
    requestsPerSecond:
      elapsedMs > 0 ? Number(((results.length * 1_000) / elapsedMs).toFixed(2)) : 0,
    networkRequestsPerSecond:
      elapsedMs > 0 ? Number(((networkRequests * 1_000) / elapsedMs).toFixed(2)) : 0,
    errorRate: results.length ? Number((errors / results.length).toFixed(4)) : 0,
    errors,
    failureClasses,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : null,
    },
  };
}

function number(value) {
  return Number(value ?? 0);
}

export class PostgresMetrics {
  constructor(connectionString) {
    this.pool = new pg.Pool({
      connectionString,
      max: 1,
      application_name: "ayin-capacity-observer",
    });
    this.samples = [];
  }

  async sample() {
    const [database, connections, jobs] = await Promise.all([
      this.pool.query(
        `SELECT numbackends, xact_commit + xact_rollback AS transactions, blks_hit, blks_read, temp_bytes, deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      ),
      this.pool.query(
        `SELECT count(*) AS total, count(*) FILTER (WHERE state = 'active') AS active, max(current_setting('max_connections')::int) AS maximum FROM pg_stat_activity WHERE datname = current_database()`,
      ),
      this.pool.query(`SELECT status, count(*) AS count FROM "MediaProcessingJob" GROUP BY status`),
    ]);
    const db = database.rows[0] ?? {};
    const connection = connections.rows[0] ?? {};
    const statuses = Object.fromEntries(jobs.rows.map((row) => [row.status, number(row.count)]));
    const queueDepth = ["INGESTING", "QUEUED", "PROCESSING", "UPLOADING", "VERIFYING"].reduce(
      (sum, status) => sum + (statuses[status] ?? 0),
      0,
    );
    const sample = {
      at: new Date().toISOString(),
      connections: number(connection.total),
      activeConnections: number(connection.active),
      maxConnections: number(connection.maximum),
      transactions: number(db.transactions),
      blockHits: number(db.blks_hit),
      blockReads: number(db.blks_read),
      tempBytes: number(db.temp_bytes),
      deadlocks: number(db.deadlocks),
      queueDepth,
      readyJobs: statuses.READY ?? 0,
      failedJobs: statuses.FAILED ?? 0,
    };
    this.samples.push(sample);
    return sample;
  }

  summarize(elapsedMs) {
    if (!this.samples.length) return { status: "no_samples" };
    const first = this.samples[0];
    const last = this.samples.at(-1);
    const hits = last.blockHits - first.blockHits;
    const reads = last.blockReads - first.blockReads;
    return {
      status: "measured",
      samples: this.samples.length,
      database: {
        peakConnections: Math.max(...this.samples.map((sample) => sample.connections)),
        peakActiveConnections: Math.max(...this.samples.map((sample) => sample.activeConnections)),
        maxConnections: last.maxConnections,
        peakConnectionUtilization: last.maxConnections
          ? Number(
              (
                Math.max(...this.samples.map((sample) => sample.connections)) / last.maxConnections
              ).toFixed(4),
            )
          : null,
        transactionDelta: last.transactions - first.transactions,
        transactionsPerSecond:
          elapsedMs > 0
            ? Number((((last.transactions - first.transactions) * 1_000) / elapsedMs).toFixed(2))
            : 0,
        cacheHitRate: hits + reads > 0 ? Number((hits / (hits + reads)).toFixed(4)) : null,
        tempBytesDelta: last.tempBytes - first.tempBytes,
        deadlocksDelta: last.deadlocks - first.deadlocks,
      },
      worker: {
        initialQueueDepth: first.queueDepth,
        finalQueueDepth: last.queueDepth,
        peakQueueDepth: Math.max(...this.samples.map((sample) => sample.queueDepth)),
        queueGrowth: last.queueDepth - first.queueDepth,
        completedJobs: last.readyJobs - first.readyJobs,
        throughputJobsPerSecond:
          elapsedMs > 0
            ? Number((((last.readyJobs - first.readyJobs) * 1_000) / elapsedMs).toFixed(3))
            : 0,
        failedJobsDelta: last.failedJobs - first.failedJobs,
      },
    };
  }

  async cleanup(runId, assetIds) {
    await this.pool.query(`DELETE FROM "AnalyticsEvent" WHERE metadata->>'capacityRunId' = $1`, [
      runId,
    ]);
    if (assetIds.length) {
      await this.pool.query(
        `DELETE FROM "MediaAsset" WHERE id = ANY($1::uuid[]) AND status IN ('PENDING', 'REJECTED')`,
        [assetIds],
      );
    }
  }

  async close() {
    await this.pool.end();
  }
}

function parsePidList(raw) {
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [label, pidText] = entry.split(":");
    const pid = Number(pidText);
    if (!label || !Number.isInteger(pid) || pid <= 0)
      throw new Error("AYIN_CAPACITY_TARGET_PIDS must use label:pid entries");
    return { label, pid };
  });
}

export class ProcessMetrics {
  constructor(rawPids) {
    this.targets = parsePidList(rawPids);
    this.samples = [];
    this.previous = new Map();
  }

  async sample() {
    const timestamp = Date.now();
    const rows = [];
    for (const target of this.targets) {
      const [stat, status] = await Promise.all([
        readFile(`/proc/${target.pid}/stat`, "utf8"),
        readFile(`/proc/${target.pid}/status`, "utf8"),
      ]);
      const fields = stat.trim().split(/\s+/);
      const ticks = number(fields[13]) + number(fields[14]);
      const rssKb = number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
      const previous = this.previous.get(target.pid);
      const cpuPercent =
        previous && timestamp > previous.timestamp
          ? Number(
              (
                ((ticks - previous.ticks) / 100 / ((timestamp - previous.timestamp) / 1_000)) *
                100
              ).toFixed(2),
            )
          : null;
      this.previous.set(target.pid, { ticks, timestamp });
      rows.push({ label: target.label, cpuPercent, rssBytes: rssKb * 1_024 });
    }
    this.samples.push(...rows);
    return rows;
  }

  summarize() {
    if (!this.targets.length) return { status: "not_configured" };
    const byProcess = {};
    for (const target of this.targets) {
      const samples = this.samples.filter((sample) => sample.label === target.label);
      byProcess[target.label] = {
        peakCpuPercent: Math.max(0, ...samples.map((sample) => sample.cpuPercent ?? 0)),
        peakRssBytes: Math.max(0, ...samples.map((sample) => sample.rssBytes)),
      };
    }
    return { status: "measured", processes: byProcess };
  }
}
