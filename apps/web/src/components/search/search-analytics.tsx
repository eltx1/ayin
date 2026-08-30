"use client";

import { useEffect } from "react";

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

export function SearchResultLinkAnalytics({ children }: { children: React.ReactNode }) {
  return (
    <span
      onClick={() => trackAnalyticsEvent("SEARCH_CLICK")}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") trackAnalyticsEvent("SEARCH_CLICK");
      }}
    >
      {children}
    </span>
  );
}
