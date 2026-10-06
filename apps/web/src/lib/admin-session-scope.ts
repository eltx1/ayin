import type { AdminSession } from "./admin-control";
import { parseAdminSession } from "./admin-dashboard";
import { stripLocalePrefix } from "./i18n/routing";

export function isAdminScopePath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return path === "/admin" || path.startsWith("/admin/");
}

/** Display/scope metadata only. None of these fields authenticate a request. */
export interface DirectAdminSession extends AdminSession {
  sessionId: string;
  authVersion: number;
}

export function parseDirectAdminSession(value: unknown): DirectAdminSession {
  const session = parseAdminSession(value);
  const row = value as Record<string, unknown>;
  if (
    typeof row.sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.sessionId) ||
    typeof row.authVersion !== "number" ||
    !Number.isSafeInteger(row.authVersion) ||
    row.authVersion < 0
  )
    throw new Error("Invalid administrative session scope");
  return { ...session, sessionId: row.sessionId, authVersion: row.authVersion };
}

export function sameAdminSessionScope(a: DirectAdminSession, b: DirectAdminSession): boolean {
  return (
    a.accountId === b.accountId &&
    a.sessionId === b.sessionId &&
    a.authVersion === b.authVersion &&
    a.roles.length === b.roles.length &&
    a.roles.every((role) => b.roles.includes(role))
  );
}

export interface AdminScopeLease {
  readonly session: DirectAdminSession;
  readonly epoch: number;
}
export type AdminScopeInvalidation = "review" | "invalidated";
// This shelf is deliberately limited to the one migrated workspace. It is not a
// general cross-route persistence framework and never serializes private drafts.
export type AdminDraftKey = "direct-campaign";

export function createAdminSessionScope() {
  let epoch = 0;
  let lease: AdminScopeLease | null = null;
  let previous: DirectAdminSession | null = null;
  let draft: unknown = null;
  const listeners = new Set<(reason: AdminScopeInvalidation) => void>();
  const notify = (reason: AdminScopeInvalidation) => {
    for (const listener of [...listeners]) {
      // A broken consumer must not prevent other native surfaces being concealed
      // or prevent the provider-owned shelf from being destroyed.
      try {
        listener(reason);
      } catch {
        continue;
      }
    }
  };
  const invalidate = () => {
    epoch++;
    lease = null;
    previous = null;
    // Consumers conceal native DOM first, before clearing their React state.
    notify("invalidated");
    draft = null;
  };
  return {
    beginRead() {
      const readEpoch = ++epoch;
      lease = null;
      notify("review");
      return readEpoch;
    },
    completeRead(readEpoch: number, value: unknown): AdminScopeLease | null {
      if (readEpoch !== epoch) return null;
      let session: DirectAdminSession;
      try {
        session = parseDirectAdminSession(value);
      } catch (error) {
        invalidate();
        throw error;
      }
      if (previous && !sameAdminSessionScope(previous, session)) {
        notify("invalidated");
        draft = null;
      }
      if (readEpoch !== epoch) return null;
      // Keep the identity used to bind the shelf independent of mutable API data.
      Object.freeze(session.roles);
      Object.freeze(session);
      previous = session;
      lease = Object.freeze({ session, epoch });
      return lease;
    },
    failRead(readEpoch: number) {
      if (readEpoch === epoch) invalidate();
    },
    invalidate,
    getScopeLease: () => lease,
    subscribeScopeInvalidation(listener: (reason: AdminScopeInvalidation) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getScopedDraft<T>(_key: AdminDraftKey, expected: AdminScopeLease): T | null {
      return lease === expected ? (draft as T | null) : null;
    },
    setScopedDraft<T>(_key: AdminDraftKey, value: T | null, expected: AdminScopeLease): boolean {
      if (lease !== expected) return false;
      draft = value;
      return true;
    },
  };
}
