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

  it("reports that the API is healthy", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "ayin-api", status: "ok" });
  });
});
