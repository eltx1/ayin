import { expect, request as playwrightRequest, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";

test("API liveness, readiness and request IDs expose safe diagnostics", async () => {
  const api = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
  const requestId = "e2e-observability-request-1234";
  const live = await api.get("/health/live", { headers: { "x-request-id": requestId } });
  expect(live.ok()).toBeTruthy();
  expect(live.headers()["x-request-id"]).toBe(requestId);
  expect(live.headers()["x-correlation-id"]).toBe(requestId);
  const liveBody = (await live.json()) as Record<string, unknown>;
  expect(liveBody.service).toBe("ayin-api");
  expect(liveBody.status).toBe("alive");
  expect(typeof liveBody.releaseSha).toBe("string");
  expect(JSON.stringify(liveBody)).not.toContain("AUTH_TOKEN_SECRET");
  expect(JSON.stringify(liveBody)).not.toContain("PAYOUT_DATA_ENCRYPTION_KEY");

  const ready = await api.get("/health/ready");
  expect(ready.ok()).toBeTruthy();
  const readyBody = (await ready.json()) as {
    status: string;
    checks: { database: { status: string }; configuration: { status: string }; worker: { status: string } };
  };
  expect(readyBody.status).toBe("ready");
  expect(readyBody.checks.database.status).toBe("ok");
  expect(readyBody.checks.configuration.status).toBe("ok");
  expect(["ok", "unknown", "disabled"]).toContain(readyBody.checks.worker.status);
  await api.dispose();
});

test("invalid inbound trace IDs are replaced instead of reflected", async () => {
  const api = await playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
  const response = await api.get("/health", { headers: { "x-request-id": "token=secret value" } });
  expect(response.ok()).toBeTruthy();
  const reflected = response.headers()["x-request-id"];
  expect(reflected).toBeTruthy();
  expect(reflected).not.toContain("secret");
  expect(reflected).not.toBe("token=secret value");
  await api.dispose();
});

test("web runtime exposes release diagnostics without environment secrets", async ({ request }) => {
  const response = await request.get(`${WEB}/api/health`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.service).toBe("ayin-web");
  expect(body.status).toBe("alive");
  expect(typeof body.requestId).toBe("string");
  expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  expect(JSON.stringify(body)).not.toContain("AUTH_TOKEN_SECRET");
});
