import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiAllowedRequestHeaders } from "../src/security/request-security.js";

/** Actual Fastify CORS plugin; no database, provider credentials or network required. */
describe("mobile operational diagnostics browser preflight", () => {
  let app: NestFastifyApplication;
  const origin = "https://ayin.stream";
  beforeAll(async () => {
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableCors({
      origin,
      credentials: true,
      allowedHeaders: apiAllowedRequestHeaders,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  it.each(["PUT", "POST"])(
    "allows trusted %s with profile and consent-version headers",
    async (method) => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/mobile/diagnostics",
        headers: {
          origin,
          "access-control-request-method": method,
          "access-control-request-headers":
            "content-type,x-ayin-expected-account,x-ayin-viewer-profile,x-ayin-diagnostics-consent-version",
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      const headers = String(response.headers["access-control-allow-headers"])
        .toLowerCase()
        .split(",")
        .map((value) => value.trim());
      expect(headers).toEqual(
        expect.arrayContaining([
          "x-ayin-expected-account",
          "x-ayin-viewer-profile",
          "x-ayin-diagnostics-consent-version",
        ]),
      );
    },
  );
  it("does not authorize an external origin", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/mobile/diagnostics",
      headers: {
        origin: "https://external.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-ayin-viewer-profile",
      },
    });
    expect(response.headers["access-control-allow-origin"]).not.toBe("https://external.example");
  });
});
