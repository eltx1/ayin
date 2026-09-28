"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
}

const ViewerProductContext = createContext<ViewerProductContextValue | null>(null);

export function ViewerProductProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<NavigationFlagState>({});
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [controls, setControls] = useState<PublicProductControls | null>(null);
  const [navigationStatus, setNavigationStatus] =
    useState<ViewerProductContextValue["navigationStatus"]>("loading");
  const [attempt, setAttempt] = useState(0);
  const retryNavigation = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setNavigationStatus("loading");

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

    void fetch(`${apiBaseUrl}/auth/me`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const nextIdentity = response.ok ? ((await response.json()) as AyinIdentity) : null;
        if (!controller.signal.aborted) setIdentity(nextIdentity);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdentity(null);
      });

    return () => controller.abort();
  }, [attempt]);

  const value = useMemo(
    () => ({ flags, identity, controls, navigationStatus, retryNavigation }),
    [flags, identity, controls, navigationStatus, retryNavigation],
  );

  return <ViewerProductContext.Provider value={value}>{children}</ViewerProductContext.Provider>;
}

export function useViewerProduct(): ViewerProductContextValue {
  const value = useContext(ViewerProductContext);
  if (!value) throw new Error("Viewer product context is required");
  return value;
}
