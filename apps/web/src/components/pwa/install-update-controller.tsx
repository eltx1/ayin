"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function InstallUpdateController() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);
  const accepting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const workers = new Set<ServiceWorker>();
    const onState = () => {
      if (active && registration?.waiting && navigator.serviceWorker.controller)
        setUpdate(registration);
    };
    const onFound = () => {
      const worker = registration?.installing;
      if (worker) {
        workers.add(worker);
        worker.addEventListener("statechange", onState);
      }
      onState();
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as BeforeInstallPromptEvent);
    };
    const onController = () => {
      if (accepting.current) window.location.reload();
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onController);
      // ready also observes registration when this component mounts before register().
      void navigator.serviceWorker.ready
        .then((reg) => {
          if (!active) return;
          registration = reg;
          reg.addEventListener("updatefound", onFound);
          onFound();
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onInstall);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener("controllerchange", onController);
      registration?.removeEventListener("updatefound", onFound);
      workers.forEach((worker) => worker.removeEventListener("statechange", onState));
      accepting.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  if (!install && !update) return null;
  return (
    <aside className="pwa-prompt" aria-live="polite">
      {error && (
        <span role="status">
          {ar ? "تعذر إكمال الطلب. حاول مرة أخرى." : "Could not complete the request. Try again."}
        </span>
      )}
      {update ? (
        <>
          <span>
            {ar
              ? "تحديث AYIN جاهز. احفظ عملك قبل إعادة تحميل الصفحة."
              : "AYIN update ready. Save your work before reloading."}
          </span>
          <button
            disabled={updating}
            onClick={() => {
              const worker = update.waiting;
              if (!worker) {
                setUpdate(null);
                return;
              }
              accepting.current = true;
              setUpdating(true);
              setError(false);
              timer.current = setTimeout(() => {
                accepting.current = false;
                setUpdating(false);
                setError(true);
              }, 10000);
              worker.postMessage({ type: "SKIP_WAITING" });
            }}
          >
            {updating
              ? ar
                ? "جارٍ التحديث…"
                : "Updating…"
              : ar
                ? "تحديث وإعادة تحميل"
                : "Update and reload"}
          </button>
        </>
      ) : (
        <>
          <span>{ar ? "ثبّت AYIN للوصول السريع." : "Install AYIN for quicker access."}</span>
          <button
            onClick={() => {
              setError(false);
              void install
                ?.prompt()
                .then(() => setInstall(null))
                .catch(() => setError(true));
            }}
          >
            {ar ? "تثبيت" : "Install"}
          </button>
          <button onClick={() => setInstall(null)}>{ar ? "ليس الآن" : "Not now"}</button>
        </>
      )}
    </aside>
  );
}
