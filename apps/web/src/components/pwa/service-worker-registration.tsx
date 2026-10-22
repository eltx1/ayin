"use client";

import { useEffect } from "react";
import { isMobileHost } from "@/lib/mobile-bridge";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (isMobileHost()) {
      // An upgraded shell can inherit a worker from its earlier PWA session.
      // Unregister without clearing upload storage or reloading an active document;
      // an existing controller retires on the next normal full navigation/relaunch.
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.allSettled(
            registrations.map(async (registration) => {
              if (new URL(registration.scope).origin === window.location.origin)
                await registration.unregister();
            }),
          ),
        )
        .catch(() => undefined);
      return;
    }
    if (process.env.NODE_ENV !== "production") return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  return null;
}
