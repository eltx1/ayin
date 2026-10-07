"use client";

import { usePathname } from "next/navigation";
import { flushSync } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import { parseNavigationFlags, type NavigationFlagState } from "@/lib/navigation";
import { parseResolvedHero, type ResolvedHero } from "@/lib/viewer-product";
import type { ProductNavigationItem } from "@/lib/viewer-navigation";

interface PublicProductControls {
  resolvedHero: ResolvedHero | null;
  navigation: ProductNavigationItem[];
  announcement: { enabled: boolean; text: string; href: string | null };
  deviceVisibility: { web: boolean; mobile: boolean; tv: boolean };
}

interface ViewerProductContextValue {
  flags: NavigationFlagState;
  identity: AyinIdentity | null;
  controls: PublicProductControls | null;
  navigationStatus: "loading" | "ready" | "error";
  retryNavigation: () => void;
  identityRevision: number;
  isIdentityCurrent: () => boolean;
  audienceStatus: "loading" | "ready" | "error";
  isAudienceCurrent: () => boolean;
  onBeforeIdentitySuspend: (listener: () => void) => () => void;
  onAudienceInvalidated: (listener: () => void) => () => void;
  claimAccountIdentity: () => {
    publish: (identity: AyinIdentity | null) => void;
    release: () => void;
  };
}

type ViewerSnapshot = Pick<ViewerProductContextValue, "flags" | "controls" | "navigationStatus">;
interface ViewerReadState extends ViewerSnapshot {
  pathname: string | null;
  revision: number;
  suspended: boolean;
}

function emptyRead(pathname: string | null, revision: number, suspended: boolean): ViewerReadState {
  return {
    pathname,
    revision,
    suspended,
    flags: {},
    controls: null,
    navigationStatus: "loading",
  };
}

interface PublishedIdentity {
  pathname: string | null;
  value: AyinIdentity | null;
  owned: boolean;
  status: "loading" | "ready" | "error";
  isCurrent: () => boolean;
}

function concealViewerIdentity() {
  // Preserve the AccountWorkspace coordinator's native conceal-before-clear
  // boundary, including an already-open dialog in the browser's top layer.
  document
    .querySelectorAll<HTMLElement>("[data-private-viewer-identity], [data-private-viewer-state]")
    .forEach((node) => {
      node.hidden = true;
      node.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
        dialog.hidden = true;
        dialog.close();
      });
    });
}

const ViewerProductContext = createContext<ViewerProductContextValue | null>(null);
const noCurrentIdentity = () => false;

export function ViewerProductProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState(() =>
    emptyRead(
      pathname,
      0,
      typeof document !== "undefined" &&
        (document.visibilityState === "hidden" || !document.hasFocus()),
    ),
  );

  const [publishedIdentity, setPublishedIdentity] = useState<PublishedIdentity | null>(null);
  const [identityRevision, setIdentityRevision] = useState(0);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const identityEpoch = useRef(0);
  const identityOwner = useRef<symbol | null>(null);
  const identityOwnerPath = useRef<string | null>(null);
  const identityRead = useRef<AbortController | null>(null);
  const identityPath = useRef(pathname);
  const beforeSuspend = useRef(new Set<() => void>());
  const audienceInvalidated = useRef(new Set<() => void>());
  const onAudienceInvalidated = useCallback((listener: () => void) => {
    audienceInvalidated.current.add(listener);
    return () => {
      audienceInvalidated.current.delete(listener);
    };
  }, []);
  const invalidateAudience = useCallback(() => {
    concealViewerIdentity();
    identityEpoch.current++;
    for (const listener of [...audienceInvalidated.current]) {
      try {
        listener();
      } catch {
        /* One consumer must not delay concealment. */
      }
    }
  }, []);
  const onBeforeIdentitySuspend = useCallback((listener: () => void) => {
    beforeSuspend.current.add(listener);
    return () => {
      beforeSuspend.current.delete(listener);
    };
  }, []);

  const publishIdentity = useCallback(
    (
      next: AyinIdentity | null,
      path: string | null,
      owned: boolean,
      status: PublishedIdentity["status"] = next ? "ready" : "loading",
    ) => {
      invalidateAudience();
      const epoch = identityEpoch.current;
      identityRead.current?.abort();
      identityRead.current = null;
      setPublishedIdentity(
        next || status !== "loading"
          ? {
              pathname: path,
              value: next,
              owned,
              status,
              // Invalidated synchronously, before a consumer's next React commit.
              isCurrent: () => identityEpoch.current === epoch && identityPath.current === path,
            }
          : null,
      );
      setIdentityRevision((value) => value + 1);
    },
    [invalidateAudience],
  );

  const claimAccountIdentity = useCallback(() => {
    const owner = Symbol("account-workspace");
    const ownerPath = identityPath.current;
    identityOwner.current = owner;
    identityOwnerPath.current = ownerPath;
    const publish = (next: AyinIdentity | null) => {
      if (identityOwner.current !== owner || identityPath.current !== ownerPath) return;
      publishIdentity(next, ownerPath, true);
    };
    publish(null);
    return {
      publish,
      release: () => {
        if (identityOwner.current !== owner) return;
        identityOwner.current = null;
        identityOwnerPath.current = null;
        publishIdentity(null, identityPath.current, false);
        // Release is not proof of identity. Ask the current session again, and
        // keep suspension if an account cleanup completes in the background.
        setIdentityAttempt((value) => value + 1);
        setState((current) =>
          emptyRead(
            current.pathname,
            current.revision + 1,
            current.suspended || document.visibilityState === "hidden" || !document.hasFocus(),
          ),
        );
      },
    };
  }, [publishIdentity]);

  useLayoutEffect(() => {
    identityPath.current = pathname;
    // A retained Account tree must not publish into a different route. Its old
    // release callback also cannot revoke a newer owner's claim.
    if (identityOwner.current && identityOwnerPath.current !== pathname) {
      identityOwner.current = null;
      identityOwnerPath.current = null;
    }
    invalidateAudience();
    identityRead.current?.abort();
    identityRead.current = null;
  }, [invalidateAudience, pathname]);

  // This layout survives soft navigation and Next may restore cached Home trees.
  // Reset during this provider's render, before children can receive old policy
  // facts. The revision also distinguishes Home→Search→Home while reads overlap.
  if (state.pathname !== pathname) {
    setState(emptyRead(pathname, state.revision + 1, state.suspended));
    setPublishedIdentity(null);
    setIdentityRevision((value) => value + 1);
  }

  const retryNavigation = useCallback(() => {
    if (!identityOwner.current) publishIdentity(null, identityPath.current, false);
    // A mutation may settle after this document was hidden or blurred. Ordinary
    // invalidation clears facts but never grants permission to resume reads.
    setState((current) =>
      emptyRead(
        current.pathname,
        current.revision + 1,
        current.suspended || document.visibilityState === "hidden" || !document.hasFocus(),
      ),
    );
  }, [publishIdentity]);

  useEffect(() => {
    // Commit the cleared snapshot before a hidden/frozen page can be restored.
    const suspend = () => {
      // Capture already-authorized final work before revoking the published
      // lease. A consumer must never postpone concealment or revalidation.
      for (const listener of [...beforeSuspend.current]) {
        try {
          listener();
        } catch {
          /* Final delivery is best-effort. */
        }
      }
      if (!identityOwner.current) publishIdentity(null, identityPath.current, false);
      flushSync(() => {
        setState((current) =>
          current.suspended ? current : emptyRead(current.pathname, current.revision + 1, true),
        );
      });
    };
    const resume = () => {
      if (document.visibilityState === "hidden" || !document.hasFocus()) return;
      flushSync(() => {
        setState((current) =>
          current.suspended ? emptyRead(current.pathname, current.revision + 1, false) : current,
        );
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") suspend();
      else resume();
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        suspend();
        return;
      }
      // A visible, focused BFCache restoration is an explicit resume signal,
      // distinct from an ordinary retry or a late mutation callback.
      if (!identityOwner.current) publishIdentity(null, identityPath.current, false);
      flushSync(() => {
        setState((current) => emptyRead(current.pathname, current.revision + 1, false));
      });
    };
    window.addEventListener("blur", suspend);
    window.addEventListener("focus", resume);
    // The existing TV runtime emits this before its pagehide/hidden pause.
    // Window-target event listeners otherwise run in registration order even
    // when capture is requested, so a later handler cannot safely race pause.
    window.addEventListener("ayin:before-page-suspend", suspend);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", suspend);
      window.removeEventListener("focus", resume);
      window.removeEventListener("ayin:before-page-suspend", suspend);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [publishIdentity]);

  const { pathname: readPath, revision, suspended } = state;
  useEffect(() => {
    if (suspended) return;
    const controller = new AbortController();
    const apply = (patch: Partial<ViewerSnapshot>) => {
      if (controller.signal.aborted) return;
      setState((current) =>
        current.pathname === readPath && current.revision === revision && !current.suspended
          ? { ...current, ...patch }
          : current,
      );
    };

    // One owner for the shell, Browse and Home. Each route activation or audience
    // restoration obtains a new policy decision; no page issues a duplicate read.
    void Promise.all([
      fetch(`${apiBaseUrl}/platform/navigation`, {
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`${apiBaseUrl}/product-controls`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(async ([flagResponse, controlResponse]) => {
        if (!flagResponse.ok || !controlResponse.ok) throw new Error("Navigation unavailable");
        const [rawFlags, rawControls] = (await Promise.all([
          flagResponse.json(),
          controlResponse.json(),
        ])) as [unknown, PublicProductControls];
        if (!Array.isArray(rawControls.navigation) || !rawControls.deviceVisibility) {
          throw new Error("Invalid navigation response");
        }
        apply({
          flags: parseNavigationFlags(rawFlags),
          controls: { ...rawControls, resolvedHero: parseResolvedHero(rawControls.resolvedHero) },
          navigationStatus: "ready",
        });
      })
      .catch(() => {
        apply({ flags: {}, controls: null, navigationStatus: "error" });
      });

    return () => controller.abort();
  }, [readPath, revision, suspended]);

  useEffect(() => {
    // AccountWorkspace owns both verified publication and the decision to
    // reopen after concealment. Public lifecycle events never bypass it.
    if (suspended || identityOwner.current) return;
    const accountRead = new AbortController();
    const observedIdentityEpoch = identityEpoch.current;
    identityRead.current = accountRead;
    const applyIdentity = (next: AyinIdentity | null, status: PublishedIdentity["status"]) => {
      if (
        !accountRead.signal.aborted &&
        observedIdentityEpoch === identityEpoch.current &&
        !identityOwner.current &&
        identityPath.current === readPath
      ) {
        publishIdentity(next, readPath, false, status);
      }
    };
    void fetch(`${apiBaseUrl}/auth/me`, {
      cache: "no-store",
      credentials: "include",
      signal: accountRead.signal,
    })
      .then(async (response) => {
        // A verified anonymous read is a usable audience for public search.
        // Network/server failures must not silently become an adult audience.
        if (response.ok) applyIdentity((await response.json()) as AyinIdentity, "ready");
        else applyIdentity(null, response.status === 401 ? "ready" : "error");
      })
      .catch(() => applyIdentity(null, "error"));
    return () => {
      accountRead.abort();
      if (identityRead.current === accountRead) identityRead.current = null;
    };
  }, [readPath, revision, suspended, identityAttempt, publishIdentity]);

  const identity =
    publishedIdentity?.pathname === pathname && (publishedIdentity.owned || !suspended)
      ? publishedIdentity.value
      : null;

  const isIdentityCurrent = identity ? publishedIdentity!.isCurrent : noCurrentIdentity;
  const audienceStatus =
    publishedIdentity?.pathname === pathname && (publishedIdentity.owned || !suspended)
      ? publishedIdentity.status
      : "loading";
  const isAudienceCurrent =
    audienceStatus === "ready" ? publishedIdentity!.isCurrent : noCurrentIdentity;

  const value = useMemo(
    () => ({
      flags: state.flags,
      identity,
      controls: state.controls,
      navigationStatus: state.navigationStatus,
      retryNavigation,
      identityRevision,
      isIdentityCurrent,
      audienceStatus,
      isAudienceCurrent,
      onBeforeIdentitySuspend,
      onAudienceInvalidated,
      claimAccountIdentity,
    }),
    [
      state.flags,
      identity,
      state.controls,
      state.navigationStatus,
      retryNavigation,
      identityRevision,
      isIdentityCurrent,
      audienceStatus,
      isAudienceCurrent,
      onBeforeIdentitySuspend,
      onAudienceInvalidated,
      claimAccountIdentity,
    ],
  );

  return <ViewerProductContext.Provider value={value}>{children}</ViewerProductContext.Provider>;
}

export function useViewerProduct(): ViewerProductContextValue {
  const value = useContext(ViewerProductContext);
  if (!value) throw new Error("Viewer product context is required");
  return value;
}
