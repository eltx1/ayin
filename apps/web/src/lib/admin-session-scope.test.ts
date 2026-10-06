import { describe, expect, it, vi } from "vitest";
import { parseAdminSession } from "./admin-dashboard";
import {
  createAdminSessionScope,
  isAdminScopePath,
  parseDirectAdminSession,
  sameAdminSessionScope,
  type DirectAdminSession,
} from "./admin-session-scope";

const session: DirectAdminSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  roles: ["AD_MANAGER"],
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 3,
};
const other = "33333333-3333-4333-8333-333333333333";
const draft = { name: "Private unfinished campaign", originalVersion: "2026-10-05T12:00:00Z" };

function setup() {
  const scope = createAdminSessionScope();
  const lease = scope.completeRead(scope.beginRead(), session)!;
  scope.setScopedDraft("direct-campaign", draft, lease);
  return { scope, lease };
}

describe("strict Admin draft session metadata", () => {
  it("recognizes English and Arabic Admin boundaries without accepting public lookalikes", () => {
    for (const path of [
      "/admin",
      "/admin/advertising",
      "/ar/admin",
      "/ar/admin/advertising",
      "/en/admin",
    ])
      expect(isAdminScopePath(path)).toBe(true);
    for (const path of [
      "/",
      "/ar/login",
      "/administrator",
      "/ar/administer",
      "/account",
      "/ar/account",
    ])
      expect(isAdminScopePath(path)).toBe(false);
  });
  it("leaves the existing account/role parser compatible with old and additive responses", () => {
    const legacy = { accountId: session.accountId, roles: session.roles };
    expect(parseAdminSession(legacy)).toEqual(legacy);
    expect(parseAdminSession(session)).toEqual(legacy);
    expect(parseDirectAdminSession(session)).toEqual(session);
    expect(() => parseDirectAdminSession(legacy)).toThrow();
  });
  it("rejects missing, malformed, nonintegral and negative session metadata", () => {
    for (const value of [
      { ...session, sessionId: "" },
      { ...session, sessionId: "bearer secret" },
      { ...session, sessionId: null },
      { ...session, authVersion: -1 },
      { ...session, authVersion: 0.5 },
      { ...session, authVersion: "3" },
      { ...session, authVersion: Number.MAX_SAFE_INTEGER + 1 },
      { ...session, roles: ["AD_MANAGER", "AD_MANAGER"] },
    ])
      expect(() => parseDirectAdminSession(value)).toThrow();
  });
  it("compares the whole role set independent of order", () => {
    expect(
      sameAdminSessionScope(
        { ...session, roles: ["OPERATIONS", "AD_MANAGER"] },
        { ...session, roles: ["AD_MANAGER", "OPERATIONS"] },
      ),
    ).toBe(true);
    expect(sameAdminSessionScope(session, { ...session, sessionId: other })).toBe(false);
  });
});

describe("provider-owned Admin draft shelf", () => {
  it("revokes leases synchronously, conceals consumers, and gates a retained candidate on revalidation", () => {
    const { scope, lease } = setup();
    const conceal = vi.fn(() => {
      expect(scope.getScopeLease()).toBeNull();
      expect(scope.getScopedDraft("direct-campaign", lease)).toBeNull();
    });
    scope.subscribeScopeInvalidation(conceal);
    const read = scope.beginRead();
    expect(conceal).toHaveBeenCalledWith("review");
    expect(scope.setScopedDraft("direct-campaign", { name: "late write" }, lease)).toBe(false);
    const current = scope.completeRead(read, session)!;
    expect(current).not.toBe(lease);
    expect(scope.getScopedDraft("direct-campaign", lease)).toBeNull();
    expect(scope.getScopedDraft("direct-campaign", current)).toEqual(draft);
  });
  it.each([
    ["account", { ...session, accountId: other }],
    ["same-account new session", { ...session, sessionId: other }],
    ["authorization version", { ...session, authVersion: 4 }],
    ["role set", { ...session, roles: ["OPERATIONS"] }],
  ])("destroys drafts after a changed %s", (_, next) => {
    const { scope } = setup();
    const listener = vi.fn();
    scope.subscribeScopeInvalidation(listener);
    const current = scope.completeRead(scope.beginRead(), next)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
    expect(listener).toHaveBeenLastCalledWith("invalidated");
  });
  it("destroys drafts even after the editor unsubscribes/unmounts", () => {
    const { scope } = setup();
    const listener = vi.fn();
    const unsubscribe = scope.subscribeScopeInvalidation(listener);
    unsubscribe();
    scope.invalidate();
    expect(listener).not.toHaveBeenCalled();
    const current = scope.completeRead(scope.beginRead(), session)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
  });
  it("destroys drafts on failed or malformed identity reads", () => {
    for (const malformed of [false, true]) {
      const { scope } = setup();
      const read = scope.beginRead();
      if (malformed) expect(() => scope.completeRead(read, { accountId: other })).toThrow();
      else scope.failRead(read);
      expect(scope.getScopeLease()).toBeNull();
      const current = scope.completeRead(scope.beginRead(), session)!;
      expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
    }
  });
  it("ignores delayed stale identity reads and failures without reviving old drafts", async () => {
    const { scope, lease } = setup();
    const oldRead = scope.beginRead();
    let resolve!: (value: unknown) => void;
    const delayed = new Promise((done) => {
      resolve = done;
    }).then((value) => scope.completeRead(oldRead, value));
    scope.invalidate();
    const current = scope.completeRead(scope.beginRead(), { ...session, sessionId: other })!;
    scope.setScopedDraft("direct-campaign", { name: "New session draft" }, current);
    resolve(session);
    expect(await delayed).toBeNull();
    scope.failRead(oldRead);
    expect(scope.getScopeLease()).toBe(current);
    expect(scope.getScopedDraft("direct-campaign", current)).toEqual({ name: "New session draft" });
    expect(scope.setScopedDraft("direct-campaign", draft, lease)).toBe(false);
  });
  it("keeps destruction effective when a consumer's cleanup throws", () => {
    const { scope } = setup();
    scope.subscribeScopeInvalidation(() => {
      throw new Error("broken consumer");
    });
    const conceal = vi.fn();
    scope.subscribeScopeInvalidation(conceal);
    expect(() => scope.invalidate()).not.toThrow();
    expect(conceal).toHaveBeenCalledWith("invalidated");
    const current = scope.completeRead(scope.beginRead(), session)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
  });
  it("does not publish a lease if a newer verification starts during invalidation", () => {
    const { scope } = setup();
    const unsubscribe = scope.subscribeScopeInvalidation((reason) => {
      if (reason === "invalidated") scope.beginRead();
    });
    expect(scope.completeRead(scope.beginRead(), { ...session, sessionId: other })).toBeNull();
    expect(scope.getScopeLease()).toBeNull();
    unsubscribe();
    const current = scope.completeRead(scope.beginRead(), session)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
  });
});

describe("fixed independent catalog retention slots", () => {
  it("keeps all three slots independent across same-session review and clears only the requested slot", () => {
    const { scope, lease } = setup();
    scope.setScopedDraft("catalog-movie", { title: "Movie draft" }, lease);
    scope.setScopedDraft("catalog-series", { title: "Series draft" }, lease);
    const current = scope.completeRead(scope.beginRead(), session)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toEqual(draft);
    expect(scope.getScopedDraft("catalog-movie", current)).toEqual({ title: "Movie draft" });
    expect(scope.getScopedDraft("catalog-series", current)).toEqual({ title: "Series draft" });
    scope.setScopedDraft("catalog-movie", null, current);
    expect(scope.getScopedDraft("catalog-movie", current)).toBeNull();
    expect(scope.getScopedDraft("catalog-series", current)).not.toBeNull();
    expect(scope.getScopedDraft("direct-campaign", current)).toEqual(draft);
  });
  it.each(["invalidated", "failed", "changed"])("clears all slots after %s identity", (reason) => {
    const { scope, lease } = setup();
    scope.setScopedDraft("catalog-movie", { private: "movie" }, lease);
    scope.setScopedDraft("catalog-series", { private: "series" }, lease);
    if (reason === "invalidated") scope.invalidate();
    else if (reason === "failed") scope.failRead(scope.beginRead());
    else scope.completeRead(scope.beginRead(), { ...session, sessionId: other });
    const current = scope.completeRead(
      scope.beginRead(),
      reason === "changed" ? { ...session, sessionId: other } : session,
    )!;
    for (const key of ["direct-campaign", "catalog-movie", "catalog-series"] as const)
      expect(scope.getScopedDraft(key, current)).toBeNull();
  });
  it("bounds serialized slots and refuses partial, cyclic and arbitrary-key writes", () => {
    const { scope, lease } = setup();
    expect(scope.setScopedDraft("catalog-series", { draft: "x".repeat(1024 * 1024) }, lease)).toBe(
      false,
    );
    expect(scope.getScopedDraft("catalog-series", lease)).toBeNull();
    expect(scope.getScopedDraft("direct-campaign", lease)).toEqual(draft);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(scope.setScopedDraft("catalog-movie", cyclic, lease)).toBe(false);
    expect(scope.setScopedDraft("other" as "catalog-movie", {}, lease)).toBe(false);
    expect(scope.setScopedDraft("catalog-series", { overflow: true }, lease)).toBe(true);
    expect(scope.getScopedDraft("catalog-series", lease)).toEqual({ overflow: true });
  });
  it("does not retain mutable references or let a reader mutate another return", () => {
    const { scope, lease } = setup();
    const candidate = { draft: { title: "Original" } };
    scope.setScopedDraft("catalog-movie", candidate, lease);
    candidate.draft.title = "Later mutation";
    const first = scope.getScopedDraft<typeof candidate>("catalog-movie", lease)!;
    expect(first.draft.title).toBe("Original");
    first.draft.title = "Reader mutation";
    expect(scope.getScopedDraft<typeof candidate>("catalog-movie", lease)?.draft.title).toBe(
      "Original",
    );
  });
});

describe("failed retention cannot revive an older campaign", () => {
  it("removes the old value, retains a scoped failure marker and preserves other keys", () => {
    const { scope, lease } = setup();
    scope.setScopedDraft("catalog-movie", { title: "Movie candidate" }, lease);
    scope.setScopedDraft("catalog-series", { title: "Series candidate" }, lease);
    expect(
      scope.setScopedDraft("direct-campaign", { latest: "r".repeat(4 * 1024 * 1024 + 1) }, lease),
    ).toBe(false);
    expect(scope.getScopedDraft("direct-campaign", lease)).toBeNull();
    expect(scope.getScopedDraftFailure("direct-campaign", lease)).toBe(true);
    const current = scope.completeRead(scope.beginRead(), session)!;
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
    expect(scope.getScopedDraftFailure("direct-campaign", current)).toBe(true);
    expect(scope.getScopedDraft("catalog-movie", current)).toEqual({ title: "Movie candidate" });
    expect(scope.getScopedDraft("catalog-series", current)).toEqual({ title: "Series candidate" });
    scope.setScopedDraft("direct-campaign", { latest: "Shortened candidate" }, current);
    expect(scope.getScopedDraftFailure("direct-campaign", current)).toBe(false);
    expect(scope.getScopedDraft("direct-campaign", current)).toEqual({
      latest: "Shortened candidate",
    });
  });
  it("destroys failure markers with all other slots on identity change", () => {
    const { scope, lease } = setup();
    scope.setScopedDraft("direct-campaign", { latest: "r".repeat(4 * 1024 * 1024 + 1) }, lease);
    const current = scope.completeRead(scope.beginRead(), { ...session, sessionId: other })!;
    expect(scope.getScopedDraftFailure("direct-campaign", current)).toBe(false);
    expect(scope.getScopedDraft("direct-campaign", current)).toBeNull();
  });
});
