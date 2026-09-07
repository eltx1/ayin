import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestTraceContext {
  requestId: string;
  correlationId: string;
}

export const requestTraceStorage = new AsyncLocalStorage<RequestTraceContext>();

const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeTraceId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return SAFE_TRACE_ID.test(trimmed) ? trimmed : null;
}

export function createRequestTraceContext(headers: Record<string, unknown>): RequestTraceContext {
  const requestId = normalizeTraceId(headers["x-request-id"]) ?? randomUUID();
  return {
    requestId,
    correlationId: normalizeTraceId(headers["x-correlation-id"]) ?? requestId,
  };
}

export function currentRequestTrace(): RequestTraceContext | null {
  return requestTraceStorage.getStore() ?? null;
}
