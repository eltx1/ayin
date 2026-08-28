import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("Task 05 public navigation feature flags", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-05-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.featureFlag.deleteMany({ where: { key: { startsWith: "navigation." } } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("keeps unfinished navigation hidden unless its allowlisted feature flag is enabled", async () => {
    const safeResponse = await app.inject({ method: "GET", url: "/platform/navigation" });
    expect(safeResponse.statusCode).toBe(200);
    expect(safeResponse.json().flags).toMatchObject({
      "navigation.movies": false,
      "navigation.series": false,
      "navigation.tv": false,
      "navigation.creators": false,
      "navigation.shorts": false,
      "navigation.kids": false,
      "navigation.my-ayin": false,
    });

    await prisma.featureFlag.create({
      data: {
        key: "navigation.tv",
        enabled: true,
        rolloutPercentage: 100,
        description: "Expose the TV navigation surface",
      },
    });

    const enabledResponse = await app.inject({ method: "GET", url: "/platform/navigation" });
    expect(enabledResponse.statusCode).toBe(200);
    expect(enabledResponse.json().flags["navigation.tv"]).toBe(true);
    expect(enabledResponse.json().flags["navigation.movies"]).toBe(false);
  });
});
