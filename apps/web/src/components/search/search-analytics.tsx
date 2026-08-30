"use client";

import { useEffect, type ReactNode } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";

export function SearchAnalytics({
  queryLength,
  resultCount,
}: {
  queryLength: number;
  resultCount: number;
}) {
  useEffect(() => {
    if (queryLength < 2) return;
    trackAnalyticsEvent("SEARCH", {
      metadata: { queryLength, resultCount },
    });
  }, [queryLength, resultCount]);
  return null;
}

export function SearchResultLinkAnalytics({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "contents" }} onClick={() => trackAnalyticsEvent("SEARCH_CLICK")}>
      {children}
    </span>
  );
}
