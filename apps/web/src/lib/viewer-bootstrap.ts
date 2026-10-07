import { apiBaseUrl, type AyinIdentity } from "./api";
import { parseAccountIdentity } from "./account-identity-response";
import { readBoundedAccountJson } from "./account-scope";

export const viewerBootstrapTimeoutMs = 15_000;

export class ViewerReadTimeoutError extends Error {
  constructor() {
    super("The viewer read timed out.");
    this.name = "ViewerReadTimeoutError";
  }
}

// Keep the lifecycle controller alive on timeout: callers use it to distinguish
// an actionable read failure from a retired route, retry, or hidden document.
// The callback must only return data; publish after this promise resolves and
// after checking the caller's own identity/route lease.
export async function withViewerReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = viewerBootstrapTimeoutMs,
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const reject = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", reject, { once: true });
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new ViewerReadTimeoutError()), timeoutMs);
  try {
    // Race the entire operation, including streamed JSON/error bodies. Merely
    // timing fetch would leave a response with held body bytes pending forever.
    const value = await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(controller.signal);
      }),
      aborted,
    ]);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", reject);
    // Also cancel sibling fetches after an early Promise.all rejection.
    controller.abort();
  }
}

export function readViewerIdentity(signal?: AbortSignal): Promise<AyinIdentity | null> {
  return withViewerReadDeadline(async (readSignal) => {
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      cache: "no-store",
      credentials: "include",
      signal: readSignal,
    });
    // Only a real 401 proves that public, anonymous discovery is appropriate.
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("Viewer identity unavailable");
    return parseAccountIdentity(await readBoundedAccountJson(response, readSignal, 32 * 1024));
  }, signal);
}

export function sameViewerIdentity(left: AyinIdentity | null, right: AyinIdentity | null): boolean {
  return left === null || right === null
    ? left === right
    : left.account.id === right.account.id && left.profile.id === right.profile.id;
}
