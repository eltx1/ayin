"use client";

import { useEffect } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";

export function AnalyticsBootstrap() {
  useEffect(() => {
    trackAnalyticsEvent("APP_OPEN");
    trackAnalyticsEvent("SESSION_OPEN");
  }, []);
  return null;
}
