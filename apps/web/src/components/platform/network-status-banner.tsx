"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";

import styles from "./network-status-banner.module.css";

type NetworkState = "online" | "offline" | "reconnected";

export function NetworkStatusBanner() {
  const { t } = useI18n();
  const [state, setState] = useState<NetworkState>("online");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const offline = () => {
      clearTimer();
      setState("offline");
    };
    const online = () => {
      clearTimer();
      setState((current) => (current === "offline" ? "reconnected" : "online"));
      timer.current = window.setTimeout(() => setState("online"), 4_000);
    };

    if (navigator.onLine === false) offline();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      clearTimer();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  if (state === "online") return null;

  return (
    <div
      aria-atomic="true"
      aria-live={state === "offline" ? "assertive" : "polite"}
      className={styles.banner}
      data-state={state}
      role="status"
    >
      {t(state === "offline" ? "network.offline" : "network.reconnected")}
    </div>
  );
}
