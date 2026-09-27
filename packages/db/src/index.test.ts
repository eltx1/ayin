import { afterEach, describe, expect, it } from "vitest";

import { databaseBaseline, resolveDatabasePoolSettings } from "./index.js";

describe("database baseline", () => {
  afterEach(() => {
    delete process.env.DATABASE_POOL_MAX;
    delete process.env.DATABASE_POOL_MIN;
    delete process.env.DATABASE_POOL_IDLE_TIMEOUT_MS;
    delete process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS;
    delete process.env.DATABASE_STATEMENT_TIMEOUT_MS;
    delete process.env.AYIN_SERVICE_NAME;
  });

  it("uses PostgreSQL and Prisma as the durable data boundary", () => {
    expect(databaseBaseline).toEqual({ orm: "prisma", provider: "postgresql" });
  });

  it("keeps connection pools bounded with conservative defaults", () => {
    const settings = resolveDatabasePoolSettings({});
    expect(settings).toEqual({
      max: 10,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 0,
      applicationName: "ayin",
    });
  });

  it("clamps pool and timeout overrides instead of allowing connection explosions", () => {
    const settings = resolveDatabasePoolSettings({
      DATABASE_POOL_MAX: "500",
      DATABASE_POOL_MIN: "30",
      DATABASE_POOL_IDLE_TIMEOUT_MS: "100",
      DATABASE_POOL_CONNECT_TIMEOUT_MS: "100000",
      DATABASE_STATEMENT_TIMEOUT_MS: "999999",
      AYIN_SERVICE_NAME: "x".repeat(100),
    });
    expect(settings.max).toBe(50);
    expect(settings.min).toBe(20);
    expect(settings.idleTimeoutMillis).toBe(1_000);
    expect(settings.connectionTimeoutMillis).toBe(60_000);
    expect(settings.statementTimeoutMillis).toBe(300_000);
    expect(settings.applicationName).toHaveLength(63);
  });
});
