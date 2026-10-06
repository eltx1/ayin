import { apiBaseUrl } from "./api";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export class AccountScopeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly writeStarted = false,
    readonly acknowledged = false,
    readonly identityUnverified = false,
  ) {
    super("The current account operation could not be verified.");
  }
}
export interface AccountScopeOptions {
  expectedAccountId?: string | undefined;
  expectedProfileId?: string | undefined;
  signal?: AbortSignal | undefined;
  allowCurrentLogout?: boolean | undefined;
  maxResponseBytes?: number | undefined;
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
export async function readBoundedAccountJson(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > 10 * 1024 * 1024)
    throw new AccountScopeError(400, "INVALID_REQUEST");
  signal.throwIfAborted();
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new AccountScopeError(0, "RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new AccountScopeError(0, "INVALID_RESPONSE");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new AccountScopeError(0, "RESPONSE_TOO_LARGE");
      parts.push(decoder.decode(next.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function json(response: Response, signal?: AbortSignal, maxBytes?: number): Promise<unknown> {
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
  return signal && maxBytes !== undefined
    ? readBoundedAccountJson(response, signal, maxBytes)
    : response.json();
}
async function actor(
  signal: AbortSignal,
  expected?: string,
  expectedProfileId?: string,
): Promise<string> {
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
  if (expectedProfileId) {
    const profileId = object(object(value).profile).id;
    if (typeof profileId !== "string" || !uuid.test(profileId))
      throw new AccountScopeError(0, "INVALID_RESPONSE");
    if (profileId.toLowerCase() !== expectedProfileId.toLowerCase())
      throw new AccountScopeError(409, "PROFILE_CHANGED");
  }
  return id.toLowerCase();
}
export async function requestAccountScope<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  decode: (value: unknown) => T,
  options: AccountScopeOptions = {},
  body?: Record<string, unknown>,
): Promise<AccountScopeResult<T>> {
  // Add only the existing Clips social routes/methods to this transport. The
  // server still authenticates the cookie and owns all authorization decisions.
  const social = path.match(
    /^\/social\/(videos|channels)\/([0-9a-f-]{36})(?:\/(reaction|subscription))?(?:\?profileId=([0-9a-f-]{36}))?$/i,
  );
  const socialPath = Boolean(
    social &&
    uuid.test(social[2]!) &&
    (social[4] === undefined || uuid.test(social[4])) &&
    ((method === "GET" && !social[3]) ||
      ((method === "PUT" || method === "DELETE") &&
        social[3] === (social[1] === "videos" ? "reaction" : "subscription") &&
        (method !== "PUT" || !social[4]))),
  );
  if (
    (!socialPath &&
      (method === "PUT" || !/^\/(auth|privacy|creator)\/[a-zA-Z0-9/_?=&%.-]+$/.test(path))) ||
    (method === "GET" && body !== undefined) ||
    (options.expectedAccountId !== undefined && !uuid.test(options.expectedAccountId)) ||
    (options.expectedProfileId !== undefined && !uuid.test(options.expectedProfileId))
  )
    throw new AccountScopeError(400, "INVALID_REQUEST");
  if (
    options.maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(options.maxResponseBytes) ||
      options.maxResponseBytes < 128 ||
      options.maxResponseBytes > 10 * 1024 * 1024)
  )
    throw new AccountScopeError(400, "INVALID_REQUEST");
  const sessionLogout = method === "DELETE" && /^\/auth\/sessions\/[0-9a-f-]{36}$/i.test(path);
  const mfaLogout = method === "POST" && path === "/auth/mfa/disable";
  if (options.allowCurrentLogout && !(sessionLogout || mfaLogout))
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
  // Identity verification is an independent privacy boundary, including GETs
  // and explicit /auth/me requests. A failed check is not a write-ACK signal.
  let verifyingIdentity = true;
  try {
    const accountId = await actor(
      controller.signal,
      options.expectedAccountId,
      options.expectedProfileId,
    );
    controller.signal.throwIfAborted();
    started = method !== "GET";
    verifyingIdentity = method === "GET" && path === "/auth/me";
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
        controller.signal,
        options.maxResponseBytes,
      ),
    );
    controller.signal.throwIfAborted();
    acknowledged = started;
    const intentionalLogout =
      options.allowCurrentLogout &&
      ((sessionLogout && object(value).currentSessionRevoked === true) ||
        (mfaLogout && object(value).disabled === true));
    if (!intentionalLogout) {
      verifyingIdentity = true;
      await actor(controller.signal, accountId, options.expectedProfileId);
    }
    controller.signal.throwIfAborted();
    return { accountId, value };
  } catch (error) {
    if (error instanceof AccountScopeError)
      throw new AccountScopeError(
        error.status,
        error.code,
        started,
        acknowledged,
        verifyingIdentity || error.identityUnverified,
      );
    throw new AccountScopeError(
      0,
      "RESPONSE_UNCONFIRMED",
      started,
      acknowledged,
      verifyingIdentity,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
