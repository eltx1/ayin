import { describe, expect, expectTypeOf, it } from "vitest";

import type { HealthResponse } from "./health.js";

describe("HealthResponse", () => {
  it("keeps the shared health contract narrow", () => {
    const response = { service: "ayin-api", status: "ok" } satisfies HealthResponse;

    expect(response.status).toBe("ok");
    expectTypeOf(response).toMatchTypeOf<HealthResponse>();
  });
});
