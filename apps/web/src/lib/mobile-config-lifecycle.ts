import { applyPendingMobileConfig, getMobileState, refreshMobileConfig } from "./mobile-runtime";
import { isMobileHost } from "./mobile-bridge";

/** One bounded foreground poller. Fetching is independent of safe activation. */
export function installMobileConfigLifecycle(signal: AbortSignal): () => void {
  const interval = 5 * 60_000;
  let lastAttempt = Date.now();
  const check = (resume = false) => {
    if (
      signal.aborted ||
      !isMobileHost() ||
      document.visibilityState !== "visible" ||
      !getMobileState().ready
    )
      return;
    void applyPendingMobileConfig(signal);
    if (Date.now() - lastAttempt < (resume ? 30_000 : interval)) return;
    lastAttempt = Date.now();
    void refreshMobileConfig(signal);
  };
  const resume = () => check(true);
  const timer = setInterval(() => check(), 10_000);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
  };
  signal.addEventListener("abort", stop, { once: true });
  return () => {
    signal.removeEventListener("abort", stop);
    stop();
  };
}
