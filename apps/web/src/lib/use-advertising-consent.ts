"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import {
  createAdvertisingConsentScope,
  getAdvertisingConsentSnapshot,
  getServerAdvertisingConsentSnapshot,
  subscribeAdvertisingConsent,
  type AdvertisingConsentSnapshot,
} from "./advertising-consent";

export function useAdvertisingConsent() {
  return useSyncExternalStore(
    subscribeAdvertisingConsent,
    getAdvertisingConsentSnapshot,
    getServerAdvertisingConsentSnapshot,
  );
}

export function useAdvertisingConsentSignal(consent: AdvertisingConsentSnapshot) {
  const binding = useMemo(() => ({ consent, controller: new AbortController() }), [consent]);
  useLayoutEffect(() => {
    const scope = createAdvertisingConsentScope(binding.consent);
    const abort = () => binding.controller.abort(scope.signal.reason);
    scope.signal.addEventListener("abort", abort, { once: true });
    if (scope.signal.aborted) abort();
    return () => {
      scope.signal.removeEventListener("abort", abort);
      scope.release();
    };
  }, [binding]);
  return binding.controller.signal;
}
