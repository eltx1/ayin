import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AppController } from "./app.controller.js";
import type { DatabaseService } from "./database/database.service.js";

function controllerWithQuery(queryRaw: ReturnType<typeof vi.fn>) {
  const database = {
    client: {
      $queryRaw: queryRaw,
    },
  } as unknown as DatabaseService;
  return new AppController(database);
}

describe("AppController health endpoints", () => {
  it("keeps liveness independent of database readiness", () => {
    const controller = controllerWithQuery(vi.fn());
    expect(controller.getHealth()).toEqual({ service: "ayin-api", status: "ok" });
  });

  it("reports ready only when the database responds", async () => {
    const queryRaw = vi.fn(async () => [{ ready: 1 }]);
    const controller = controllerWithQuery(queryRaw);

    await expect(controller.getReadiness()).resolves.toEqual({
      service: "ayin-api",
      status: "ready",
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("fails readiness closed without leaking database errors", async () => {
    const queryRaw = vi.fn(async () => {
      throw new Error("database hostname and credential details must not leak");
    });
    const controller = controllerWithQuery(queryRaw);

    try {
      await controller.getReadiness();
      throw new Error("expected readiness to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        service: "ayin-api",
        status: "not_ready",
      });
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
        "hostname",
      );
    }
  });
});
