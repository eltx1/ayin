"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAdminSession, type AdminSession } from "@/lib/admin-control";
import {
  createAdminSessionScope,
  isAdminScopePath,
  type AdminDraftKey,
  type AdminScopeInvalidation,
  type AdminScopeLease,
} from "@/lib/admin-session-scope";

interface Access {
  session: AdminSession | null;
  error: string;
  loading: boolean;
  refresh: () => void;
  getScopeLease: () => AdminScopeLease | null;
  invalidateScope: () => void;
  subscribeScopeInvalidation: (listener: (reason: AdminScopeInvalidation) => void) => () => void;
  getScopedDraft: <T>(key: AdminDraftKey, lease: AdminScopeLease) => T | null;
  setScopedDraft: <T>(key: AdminDraftKey, value: T | null, lease: AdminScopeLease) => boolean;
}
const Context = createContext<Access | null>(null);

export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [scope] = useState(createAdminSessionScope);
  const pending = useRef<AbortController | null>(null);
  const verifiedPath = useRef<string | null>(null);
  const [result, setResult] = useState<{
    pathname: string;
    session: AdminSession | null;
    error: string;
    loading: boolean;
  } | null>(null);

  const stopRead = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    verifiedPath.current = null;
  }, []);
  const invalidateScope = useCallback(() => {
    stopRead();
    scope.invalidate();
    setResult({
      pathname: window.location.pathname,
      session: null,
      error: "Admin access unavailable.",
      loading: false,
    });
  }, [scope, stopRead]);
  const refresh = useCallback(() => {
    stopRead();
    const path = window.location.pathname;
    if (!isAdminScopePath(path) || document.visibilityState === "hidden") {
      invalidateScope();
      return;
    }
    const readEpoch = scope.beginRead();
    const controller = new AbortController();
    pending.current = controller;
    setResult({ pathname: path, session: null, error: "", loading: true });
    void getAdminSession(controller.signal)
      .then((value) => {
        if (controller.signal.aborted || pending.current !== controller) return;
        if (path !== window.location.pathname || document.visibilityState === "hidden") {
          invalidateScope();
          return;
        }
        const lease = scope.completeRead(readEpoch, value);
        if (!lease) return;
        pending.current = null;
        verifiedPath.current = path;
        setResult({ pathname: path, session: lease.session, error: "", loading: false });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || pending.current !== controller) return;
        pending.current = null;
        scope.failRead(readEpoch);
        setResult({
          pathname: path,
          session: null,
          error: cause instanceof Error ? cause.message : "Admin access unavailable.",
          loading: false,
        });
      });
  }, [invalidateScope, scope, stopRead]);

  // The provider persists between Admin pages. Revoke the old lease and conceal
  // opted-in native surfaces before a route commit can paint, then verify again.
  useLayoutEffect(() => {
    stopRead();
    scope.beginRead();
    let active = true;
    void Promise.resolve().then(() => {
      if (active) refresh();
    });
    return () => {
      active = false;
      stopRead();
    };
  }, [pathname, refresh, scope, stopRead]);

  useLayoutEffect(
    () => () => {
      // Leaving the Admin layout destroys retained drafts before the next paint,
      // including a programmatic navigation with no anchor click or pagehide.
      stopRead();
      scope.invalidate();
    },
    [scope, stopRead],
  );

  useEffect(() => {
    const suspend = () => invalidateScope();
    const resume = () => {
      if (document.visibilityState !== "hidden" && isAdminScopePath(window.location.pathname))
        refresh();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") suspend();
      else resume();
    };
    const history = () => {
      if (isAdminScopePath(window.location.pathname)) refresh();
      else suspend();
    };
    const navigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !isAdminScopePath(url.pathname)) {
        suspend();
      } else if (url.pathname !== window.location.pathname) {
        // Preserve the inaccessible candidate only for navigation within Admin.
        // The destination's route effect supplies a fresh session read.
        stopRead();
        scope.beginRead();
        setResult(null);
      }
    };
    window.addEventListener("pagehide", suspend, true);
    window.addEventListener("pageshow", resume, true);
    window.addEventListener("popstate", history, true);
    document.addEventListener("freeze", suspend, true);
    document.addEventListener("resume", resume, true);
    document.addEventListener("visibilitychange", visibility, true);
    // Dirty-edit capture guards may cancel before we conceal private surfaces.
    document.addEventListener("click", navigation);
    return () => {
      window.removeEventListener("pagehide", suspend, true);
      window.removeEventListener("pageshow", resume, true);
      window.removeEventListener("popstate", history, true);
      document.removeEventListener("freeze", suspend, true);
      document.removeEventListener("resume", resume, true);
      document.removeEventListener("visibilitychange", visibility, true);
      document.removeEventListener("click", navigation);
      stopRead();
      scope.invalidate();
    };
  }, [invalidateScope, refresh, scope, stopRead]);

  const getScopeLease = useCallback(() => {
    if (
      document.visibilityState === "hidden" ||
      !isAdminScopePath(window.location.pathname) ||
      verifiedPath.current !== window.location.pathname
    )
      return null;
    return scope.getScopeLease();
  }, [scope]);
  const getScopedDraft = useCallback(
    <T,>(key: AdminDraftKey, lease: AdminScopeLease): T | null =>
      getScopeLease() === lease ? scope.getScopedDraft<T>(key, lease) : null,
    [getScopeLease, scope],
  );
  const setScopedDraft = useCallback(
    <T,>(key: AdminDraftKey, value: T | null, lease: AdminScopeLease): boolean =>
      getScopeLease() === lease && scope.setScopedDraft(key, value, lease),
    [getScopeLease, scope],
  );
  const current = result?.pathname === pathname ? result : null;
  return (
    <Context.Provider
      value={{
        session: current?.session ?? null,
        error: current?.error ?? "",
        loading: current?.loading ?? true,
        refresh,
        getScopeLease,
        invalidateScope,
        subscribeScopeInvalidation: scope.subscribeScopeInvalidation,
        getScopedDraft,
        setScopedDraft,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAdminAccess() {
  const context = useContext(Context);
  if (!context) throw new Error("Admin access requires the Admin layout.");
  return context;
}
