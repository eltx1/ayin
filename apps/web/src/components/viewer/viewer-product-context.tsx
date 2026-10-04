"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import { parseNavigationFlags, type NavigationFlagState } from "@/lib/navigation";
import type { ProductNavigationItem } from "@/lib/viewer-navigation";

interface PublicProductControls {
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

const ViewerProductContext = createContext<ViewerProductContextValue | null>(null);

export function ViewerProductProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<NavigationFlagState>({});
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [identityRevision, setIdentityRevision] = useState(0);
  const identityEpoch = useRef(0);
  const identityOwner = useRef<symbol | null>(null);
  const identityRead = useRef<AbortController | null>(null);
  const claimAccountIdentity = useCallback(() => {
    const owner = Symbol("account-workspace");
    identityOwner.current = owner;
    const publish = (next: AyinIdentity | null) => {
      if (identityOwner.current !== owner) return;
      // Conceal even an open menu before clearing its old identity or pending read.
      document.querySelectorAll<HTMLElement>("[data-private-viewer-identity]").forEach((node) => {
        node.hidden = true;
        node.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
          dialog.hidden = true;
          dialog.close();
        });
      });
      identityEpoch.current++;
      identityRead.current?.abort();
      identityRead.current = null;
      setIdentity(next);
      setIdentityRevision((value) => value + 1);
    };
    publish(null);
    return {
      publish,
      release: () => {
        if (identityOwner.current === owner) identityOwner.current = null;
      },
    };
  }, []);
  const [controls, setControls] = useState<PublicProductControls | null>(null);
  const [navigationStatus, setNavigationStatus] =
    useState<ViewerProductContextValue["navigationStatus"]>("loading");
  const [attempt, setAttempt] = useState(0);
  const retryNavigation = useCallback(() => {
    setNavigationStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // One shared pair of public reads for both the shell and Browse, never per link.
    void Promise.all([
      fetch(`${apiBaseUrl}/platform/navigation`, {
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`${apiBaseUrl}/product-controls`, {
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
        if (controller.signal.aborted) return;
        setFlags(parseNavigationFlags(rawFlags));
        setControls(rawControls);
        setNavigationStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // No stale enabled feature links after a failed configuration refresh.
        setFlags({});
        setControls(null);
        setNavigationStatus("error");
      });

    const accountRead = new AbortController();
    const observedIdentityEpoch = identityEpoch.current;
    identityRead.current = accountRead;
    if (!identityOwner.current)
      void fetch(`${apiBaseUrl}/auth/me`, {
        cache: "no-store",
        credentials: "include",
        signal: accountRead.signal,
      })
        .then(async (response) => {
          const nextIdentity = response.ok ? ((await response.json()) as AyinIdentity) : null;
          if (
            !accountRead.signal.aborted &&
            observedIdentityEpoch === identityEpoch.current &&
            !identityOwner.current
          )
            setIdentity(nextIdentity);
        })
        .catch(() => {
          if (
            !accountRead.signal.aborted &&
            observedIdentityEpoch === identityEpoch.current &&
            !identityOwner.current
          )
            setIdentity(null);
        });

    return () => {
      controller.abort();
      accountRead.abort();
    };
  }, [attempt]);

  const value = useMemo(
    () => ({
      flags,
      identity,
      controls,
      navigationStatus,
      retryNavigation,
      identityRevision,
      claimAccountIdentity,
    }),
    [
      flags,
      identity,
      controls,
      navigationStatus,
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
