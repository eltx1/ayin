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
  value: AyinIdentity;
  owned: boolean;
}

function concealViewerIdentity() {
  // Preserve the AccountWorkspace coordinator's native conceal-before-clear
  // boundary, including an already-open dialog in the browser's top layer.
  document.querySelectorAll<HTMLElement>("[data-private-viewer-identity]").forEach((node) => {
    node.hidden = true;
    node.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
      dialog.hidden = true;
      dialog.close();
    });
  });
}

const ViewerProductContext = createContext<ViewerProductContextValue | null>(null);

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

  const publishIdentity = useCallback(
    (next: AyinIdentity | null, path: string | null, owned: boolean) => {
      concealViewerIdentity();
      identityEpoch.current++;
      identityRead.current?.abort();
      identityRead.current = null;
      setPublishedIdentity(next ? { pathname: path, value: next, owned } : null);
      setIdentityRevision((value) => value + 1);
    },
    [],
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
    concealViewerIdentity();
    identityEpoch.current++;
    identityRead.current?.abort();
    identityRead.current = null;
  }, [pathname]);

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
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", suspend);
      window.removeEventListener("focus", resume);
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
    const applyIdentity = (next: AyinIdentity | null) => {
      if (
        !accountRead.signal.aborted &&
        observedIdentityEpoch === identityEpoch.current &&
        !identityOwner.current &&
        identityPath.current === readPath
      ) {
        publishIdentity(next, readPath, false);
      }
    };
    void fetch(`${apiBaseUrl}/auth/me`, {
      cache: "no-store",
      credentials: "include",
      signal: accountRead.signal,
    })
      .then(async (response) => {
        applyIdentity(response.ok ? ((await response.json()) as AyinIdentity) : null);
      })
      .catch(() => applyIdentity(null));
    return () => {
      accountRead.abort();
      if (identityRead.current === accountRead) identityRead.current = null;
    };
  }, [readPath, revision, suspended, identityAttempt, publishIdentity]);

  const identity =
    publishedIdentity?.pathname === pathname && (publishedIdentity.owned || !suspended)
      ? publishedIdentity.value
      : null;

  const value = useMemo(
    () => ({
      flags: state.flags,
      identity,
      controls: state.controls,
      navigationStatus: state.navigationStatus,
      retryNavigation,
      identityRevision,
      claimAccountIdentity,
    }),
    [
      state.flags,
      identity,
      state.controls,
      state.navigationStatus,
      retryNavigation,
      identityRevision,
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
