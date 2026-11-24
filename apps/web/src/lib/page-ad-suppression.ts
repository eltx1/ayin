import { stripLocalePrefix } from "./i18n/routing";

/**
 * Child-directed surfaces never show outside-player advertising. Route-level kids mode
 * (/kids, ?kids=1) is read from the URL; a kids viewer profile on a normal route is
 * declared by the page that knows it (for example the watch page) through this store.
 */
const declared = new Set<symbol>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function suppressPageAds(): () => void {
  const lease = Symbol("page-ad-suppression");
  declared.add(lease);
  notify();
  return () => {
    declared.delete(lease);
    notify();
  };
}

export function subscribePageAdSuppression(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function pageAdsSuppressedForLocation(pathname: string, search: string) {
  const route = stripLocalePrefix(pathname);
  if (route === "/kids" || route.startsWith("/kids/")) return true;
  return new URLSearchParams(search).get("kids") === "1";
}

export function pageAdsSuppressed(): boolean {
  if (declared.size > 0) return true;
  return pageAdsSuppressedForLocation(window.location.pathname, window.location.search);
}
