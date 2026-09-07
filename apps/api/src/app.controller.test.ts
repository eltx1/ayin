import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AppController } from "./app.controller.js";
import type { ObservabilityService } from "./observability/observability.service.js";

function controllerWithObservability(input: {
  live?: ReturnType<typeof vi.fn>;
  ready?: ReturnType<typeof vi.fn>;
}) {
  const observability = {
    live:
      input.live ??
      vi.fn(async () => ({
        service: "ayin-api",
        status: "alive" as const,
        releaseSha: "unknown",
        uptimeSeconds: 1,
        process: { pid: 1, node: process.version },
      })),
    ready:
      input.ready ??
      vi.fn(async () => ({
        service: "ayin-api",
        status: "ready" as const,
        releaseSha: "unknown",
        checks: {
          database: { status: "ok" as const, latencyMs: 1 },
          configuration: { status: "ok" as const },
          worker: { status: "disabled" as const },
        },
      })),
  } as unknown as ObservabilityService;
  return new AppController(observability);
}

describe("AppController health endpoints", () => {
  it("keeps liveness independent of readiness checks", async () => {
    const live = vi.fn(async () => ({ service: "ayin-api", status: "alive" as const }));
    const controller = controllerWithObservability({ live });

    await expect(controller.getHealth()).resolves.toEqual({
      service: "ayin-api",
      status: "alive",
    });
    expect(live).toHaveBeenCalledOnce();
  });

  it("reports ready only when all readiness checks pass", async () => {
    const readiness = {
      service: "ayin-api",
      status: "ready" as const,
      releaseSha: "unknown",
      checks: {
        database: { status: "ok" as const, latencyMs: 1 },
        configuration: { status: "ok" as const },
        worker: { status: "disabled" as const },
      },
    };
    const ready = vi.fn(async () => readiness);
    const controller = controllerWithObservability({ ready });

    await expect(controller.getReadiness()).resolves.toEqual(readiness);
    expect(ready).toHaveBeenCalledOnce();
  });

  it("fails readiness closed without leaking internal check details outside the structured payload", async () => {
    const readiness = {
      service: "ayin-api",
      status: "not_ready" as const,
      releaseSha: "unknown",
      checks: {
        database: { status: "unhealthy" as const },
        configuration: { status: "ok" as const },
        worker: { status: "unknown" as const, reason: "heartbeat_missing" },
      },
    };
    const controller = controllerWithObservability({ ready: vi.fn(async () => readiness) });

    try {
      await controller.getReadiness();
      throw new Error("expected readiness to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual(readiness);
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
        "credential",
      );
    }
  });
});
