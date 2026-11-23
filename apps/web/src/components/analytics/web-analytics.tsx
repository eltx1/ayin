"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { isMobileHost, mobileScreenName } from "@/lib/mobile-bridge";
import { useI18n } from "@/components/i18n/i18n-provider";

const measurementId = "G-0ZC4Y6Z8PJ";
const preference = "ayin.ga4.web.opt-in";
const change = "ayin:web-analytics-preference";
let loaded = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    "ga-disable-G-0ZC4Y6Z8PJ"?: boolean;
  }
}

function optedIn() {
  try {
    return window.localStorage.getItem(preference) === "yes";
  } catch {
    return false;
  }
}

function tag(...commands: unknown[]) {
  if (!commands.length) return;
  // The Google tag consumes the arguments object for each queued command.
  // eslint-disable-next-line prefer-rest-params -- gtag expects an arguments object.
  (window.dataLayer ??= []).push(arguments);
}

export function WebAnalytics() {
  const path = usePathname();
  useEffect(() => {
    if (window.location.hostname !== "ayin.stream" || window.AyinNative || isMobileHost()) return;
    const apply = () => {
      const allowed = optedIn();
      window["ga-disable-G-0ZC4Y6Z8PJ"] = !allowed;
      if (!allowed) return;
      const screen = mobileScreenName(path);
      const fields = {
        page_location: window.location.origin + "/" + screen,
        page_title: screen,
        page_referrer: "",
      };
      if (!loaded) {
        loaded = true;
        tag("consent", "default", {
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        tag("js", new Date());
        tag("config", measurementId, {
          ...fields,
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        });
        const script = document.createElement("script");
        script.async = true;
        script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
        document.head.appendChild(script);
      }
      tag("event", "page_view", fields);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === preference || event.key === null) apply();
    };
    apply();
    window.addEventListener(change, apply);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(change, apply);
      window.removeEventListener("storage", storage);
    };
  }, [path]);
  return null;
}

function subscribe(listener: () => void) {
  window.addEventListener(change, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(change, listener);
    window.removeEventListener("storage", listener);
  };
}

export function WebAnalyticsPreference() {
  const state = useSyncExternalStore(
    subscribe,
    () => (window.AyinNative || isMobileHost() ? "native" : optedIn() ? "enabled" : "disabled"),
    () => "native",
  );
  const { locale } = useI18n();
  if (state === "native") return null;
  return (
    <label>
      <input
        type="checkbox"
        checked={state === "enabled"}
        onChange={(event) => {
          try {
            localStorage.setItem(preference, event.target.checked ? "yes" : "no");
            window.dispatchEvent(new Event(change));
          } catch {
            // Storage is unavailable in this browser.
          }
        }}
      />{" "}
      {locale === "ar"
        ? "السماح بإرسال مشاهدات الصفحات إلى Google Analytics على هذا المتصفح"
        : "Allow AYIN to send page views to Google Analytics in this browser"}
    </label>
  );
}
