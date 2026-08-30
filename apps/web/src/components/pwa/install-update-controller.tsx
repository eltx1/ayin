"use client";
import { useEffect, useState } from "react";
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function InstallUpdateController() {
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) setUpdate(reg);
        reg?.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (worker)
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller)
                setUpdate(reg);
            });
        });
      });
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);
  if (!install && !update) return null;
  return (
    <aside className="pwa-prompt" aria-live="polite">
      {update ? (
        <>
          <span>AYIN update ready.</span>
          <button
            onClick={() => {
              update.waiting?.postMessage({ type: "SKIP_WAITING" });
              location.reload();
            }}
          >
            Update
          </button>
        </>
      ) : (
        <>
          <span>Install AYIN for quicker access.</span>
          <button
            onClick={() => {
              void install?.prompt().then(() => setInstall(null));
            }}
          >
            Install
          </button>
          <button onClick={() => setInstall(null)}>Not now</button>
        </>
      )}
    </aside>
  );
}
