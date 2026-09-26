import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../src/database/database.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("Task 86 PostgreSQL observability", () => {
  let database: DatabaseService;
  let previousDatabaseUrl: string | undefined;
  let previousServiceName: string | undefined;

  beforeAll(() => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    previousServiceName = process.env.AYIN_SERVICE_NAME;
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.AYIN_SERVICE_NAME = "ayin-task86-observability-test";
    database = new DatabaseService();
  });

  afterAll(async () => {
    await database.onModuleDestroy();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousServiceName === undefined) delete process.env.AYIN_SERVICE_NAME;
    else process.env.AYIN_SERVICE_NAME = previousServiceName;
  });

  it("reports bounded pool settings and live AYIN-role connection counts", async () => {
    const snapshot = await database.postgresPerformanceSnapshot();

    expect(snapshot.pool.max).toBeGreaterThanOrEqual(1);
    expect(snapshot.pool.max).toBeLessThanOrEqual(50);
    expect(snapshot.pool.applicationName).toBe("ayin-task86-observability-test");
    expect(snapshot.server.maxConnections).toBeGreaterThan(0);
    expect(snapshot.server.totalConnections).toBeGreaterThanOrEqual(1);
    expect(snapshot.server.idleInTransactionConnections).toBeGreaterThanOrEqual(0);
    expect(snapshot.server.byApplication).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationName: "ayin-task86-observability-test",
          connections: expect.any(Number),
        }),
      ]),
    );
    expect(typeof snapshot.slowStatements.extensionInstalled).toBe("boolean");
    expect(Array.isArray(snapshot.slowStatements.rows)).toBe(true);
  });
});
