"use client";

import { useEffect } from "react";
import { isMobileHost } from "@/lib/mobile-bridge";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      isMobileHost() ||
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  return null;
}
