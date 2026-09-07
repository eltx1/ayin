import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createRequestTraceContext, requestTraceStorage } from "./observability-context.js";
import type { ObservabilityService } from "./observability.service.js";
import type { StructuredLoggerService } from "./structured-logger.service.js";

const requestStartedAt = new WeakMap<FastifyRequest, number>();
const HEALTH_PATHS = new Set(["/health", "/ready", "/health/live", "/health/ready"]);

export function registerObservabilityHooks(
  fastify: FastifyInstance,
  observability: ObservabilityService,
  logger: StructuredLoggerService,
): void {
  fastify.addHook("onRequest", (request, reply, done) => {
    const trace = createRequestTraceContext(request.headers as Record<string, unknown>);
    requestStartedAt.set(request, performance.now());
    reply.header("x-request-id", trace.requestId);
    reply.header("x-correlation-id", trace.correlationId);
    requestTraceStorage.run(trace, done);
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const started = requestStartedAt.get(request) ?? performance.now();
    const latencyMs = Math.max(0, performance.now() - started);
    const path = safePath(request);
    observability.recordRequest({
      method: request.method,
      path,
      statusCode: reply.statusCode,
      latencyMs,
    });
    if (HEALTH_PATHS.has(path) && reply.statusCode < 400) return;
    logger.event(reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info", "http.request", {
      method: request.method,
      path,
      statusCode: reply.statusCode,
      latencyMs: Math.round(latencyMs * 100) / 100,
    });
  });
}

function safePath(request: FastifyRequest): string {
  const route = request.routeOptions?.url;
  if (route) return route;
  const index = request.url.indexOf("?");
  return index >= 0 ? request.url.slice(0, index) : request.url;
}

export function responseTraceHeaders(reply: FastifyReply): Record<string, string | undefined> {
  return {
    requestId: String(reply.getHeader("x-request-id") ?? "") || undefined,
    correlationId: String(reply.getHeader("x-correlation-id") ?? "") || undefined,
  };
}
