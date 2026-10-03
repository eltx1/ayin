"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton } from "@/components/ui/design-system";
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
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const [error, setError] = useState(false);
  const accepting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const workers = new Set<ServiceWorker>();
    let controlled = "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);
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
      if (!active) return;
      const shouldReload = accepting.current;
      if (controlled || shouldReload) {
        accepting.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setUpdating(false);
        setError(false);
        setUpdate(null);
        setReloadAvailable(true);
        // The other tabs, a late activation, or a dismissed native leave
        // dialog retain an explicit refresh action instead of losing work.
        if (shouldReload) window.location.reload();
      }
      controlled = Boolean(navigator.serviceWorker.controller);
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
  if (!install && !update && !reloadAvailable) return null;
  return (
    <aside className="pwa-prompt" aria-live="polite">
      {error && (
        <span role="status">
          {ar ? "تعذر إكمال الطلب. حاول مرة أخرى." : "Could not complete the request. Try again."}
        </span>
      )}
      {reloadAvailable ? (
        <>
          <span>
            {ar
              ? "تم تحديث AYIN. احفظ عملك ثم أعد تحميل الصفحة عندما تكون جاهزًا."
              : "AYIN updated. Save your work, then reload when you are ready."}
          </span>
          <ActionButton onClick={() => window.location.reload()}>
            {ar ? "إعادة تحميل AYIN" : "Reload AYIN"}
          </ActionButton>
        </>
      ) : update ? (
        <>
          <span>
            {ar
              ? "تحديث AYIN جاهز. احفظ عملك قبل إعادة تحميل الصفحة."
              : "AYIN update ready. Save your work before reloading."}
          </span>
          <ActionButton
            disabled={updating}
            onClick={() => {
              if (accepting.current) return;
              const worker = update.waiting;
              if (!worker) {
                setUpdate(null);
                setReloadAvailable(true);
                return;
              }
              accepting.current = true;
              setUpdating(true);
              setError(false);
              timer.current = setTimeout(() => {
                timer.current = null;
                accepting.current = false;
                setUpdating(false);
                setError(true);
              }, 10000);
              try {
                worker.postMessage({ type: "SKIP_WAITING" });
              } catch {
                if (timer.current) clearTimeout(timer.current);
                timer.current = null;
                accepting.current = false;
                setUpdating(false);
                setError(true);
              }
            }}
          >
            {updating
              ? ar
                ? "جارٍ التحديث…"
                : "Updating…"
              : ar
                ? "تحديث وإعادة تحميل"
                : "Update and reload"}
          </ActionButton>
        </>
      ) : (
        <>
          <span>{ar ? "ثبّت AYIN للوصول السريع." : "Install AYIN for quicker access."}</span>
          <ActionButton
            onClick={() => {
              setError(false);
              void install
                ?.prompt()
                .then(() => setInstall(null))
                .catch(() => setError(true));
            }}
          >
            {ar ? "تثبيت" : "Install"}
          </ActionButton>
          <ActionButton tone="quiet" onClick={() => setInstall(null)}>
            {ar ? "ليس الآن" : "Not now"}
          </ActionButton>
        </>
      )}
    </aside>
  );
}
