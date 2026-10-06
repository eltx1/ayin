import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";

test("real API preflight permits localized suggestions only for the configured web origin", async ({
  request,
}) => {
  const endpoint = `${API}/public/search/suggestions?q=ayin`;
  for (const origin of [WEB, "https://untrusted.e2e.ayin.test"]) {
    const response = await request.fetch(endpoint, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-ayin-locale",
      },
    });
    const headers = response.headers();
    expect(response.status()).toBe(204);
    expect(headers["access-control-allow-origin"]).toBe(WEB);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(
      headers["access-control-allow-headers"]
        ?.split(",")
        .map((value) => value.trim().toLowerCase()),
    ).toContain("x-ayin-locale");
    if (origin !== WEB) expect(headers["access-control-allow-origin"]).not.toBe(origin);
  }
  const localized = await request.get(endpoint, {
    headers: { origin: WEB, "x-ayin-locale": "ar" },
  });
  expect(localized.status()).toBe(200);
  expect(localized.headers()["access-control-allow-origin"]).toBe(WEB);
  const result = await localized.json();
  expect(result.query).toBe("ayin");
  expect(Array.isArray(result.suggestions)).toBe(true);
});
