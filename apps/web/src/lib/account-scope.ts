import { apiBaseUrl } from "./api";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export class AccountScopeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly writeStarted = false,
    readonly acknowledged = false,
  ) {
    super("The current account operation could not be verified.");
  }
}
export interface AccountScopeOptions {
  expectedAccountId?: string | undefined;
  signal?: AbortSignal | undefined;
  allowCurrentLogout?: boolean | undefined;
}
export interface AccountScopeResult<T> {
  accountId: string;
  value: T;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    let code: unknown;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const detail = (error as Record<string, unknown>).error;
      if (detail && typeof detail === "object" && !Array.isArray(detail))
        code = (detail as Record<string, unknown>).code;
    }
    throw new AccountScopeError(
      response.status,
      typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : "REQUEST_REJECTED",
    );
  }
  return response.json();
}
async function actor(signal: AbortSignal, expected?: string): Promise<string> {
  signal.throwIfAborted();
  const value = await json(
    await fetch(apiBaseUrl + "/auth/me", {
      credentials: "include",
      cache: "no-store",
      signal,
      ...(expected ? { headers: { "x-ayin-expected-account": expected } } : {}),
    }),
  );
  signal.throwIfAborted();
  const id = object(object(value).account).id;
  if (typeof id !== "string" || !uuid.test(id)) throw new AccountScopeError(0, "INVALID_RESPONSE");
  if (expected && id.toLowerCase() !== expected.toLowerCase())
    throw new AccountScopeError(409, "ACCOUNT_CHANGED");
  return id.toLowerCase();
}
export async function requestAccountScope<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  decode: (value: unknown) => T,
  options: AccountScopeOptions = {},
  body?: Record<string, unknown>,
): Promise<AccountScopeResult<T>> {
  if (
    !/^\/(auth|privacy|creator)\/[a-zA-Z0-9/_?=&%.-]+$/.test(path) ||
    (method === "GET" && body !== undefined) ||
    (options.expectedAccountId !== undefined && !uuid.test(options.expectedAccountId))
  )
    throw new AccountScopeError(400, "INVALID_REQUEST");
  if (
    options.allowCurrentLogout &&
    !(method === "DELETE" && /^\/auth\/sessions\/[0-9a-f-]{36}$/i.test(path))
  )
    throw new AccountScopeError(400, "INVALID_REQUEST");
  options.signal?.throwIfAborted();
  const controller = new AbortController(),
    abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Account deadline exceeded.")),
    method === "GET" ? 15000 : 30000,
  );
  let started = false,
    acknowledged = false;
  try {
    const accountId = await actor(controller.signal, options.expectedAccountId);
    controller.signal.throwIfAborted();
    started = method !== "GET";
    const value = decode(
      await json(
        await fetch(apiBaseUrl + path, {
          method,
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "x-ayin-expected-account": accountId,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      ),
    );
    controller.signal.throwIfAborted();
    acknowledged = started;
    const intentionalLogout =
      options.allowCurrentLogout && object(value).currentSessionRevoked === true;
    if (!intentionalLogout) await actor(controller.signal, accountId);
    controller.signal.throwIfAborted();
    return { accountId, value };
  } catch (error) {
    if (error instanceof AccountScopeError)
      throw new AccountScopeError(error.status, error.code, started, acknowledged);
    throw new AccountScopeError(0, "RESPONSE_UNCONFIRMED", started, acknowledged);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
