import "reflect-metadata";

import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

describe("GET /health", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports process liveness with safe release diagnostics", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json() as {
      service: string;
      status: string;
      releaseSha: string;
      uptimeSeconds: number;
      process: { pid: number; node: string };
    };

    expect(response.statusCode).toBe(200);
    expect(body.service).toBe("ayin-api");
    expect(body.status).toBe("alive");
    expect(typeof body.releaseSha).toBe("string");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.process.pid).toBeGreaterThan(0);
    expect(body.process.node).toBe(process.version);
    expect(JSON.stringify(body)).not.toContain("AUTH_TOKEN_SECRET");
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
