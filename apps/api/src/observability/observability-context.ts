import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestTraceContext {
  requestId: string;
  correlationId: string;
}

export const requestTraceStorage = new AsyncLocalStorage<RequestTraceContext>();

const UUID_TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_TRACE_ID = /^(?:[0-9a-f]{16}|[0-9a-f]{32})$/i;
const ULID_TRACE_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function normalizeTraceId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return UUID_TRACE_ID.test(trimmed) || HEX_TRACE_ID.test(trimmed) || ULID_TRACE_ID.test(trimmed)
    ? trimmed
    : null;
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
