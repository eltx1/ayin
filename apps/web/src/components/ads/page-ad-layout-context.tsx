"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { PageAdLayoutSlot } from "@/lib/page-ad-layout";

const PageAdLayoutContext = createContext<ReadonlyMap<string, PageAdLayoutSlot>>(new Map());

export function PageAdLayoutProvider({
  slots,
  children,
}: {
  slots: PageAdLayoutSlot[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Map(slots.map((slot) => [slot.key, slot])), [slots]);
  return <PageAdLayoutContext.Provider value={value}>{children}</PageAdLayoutContext.Provider>;
}

export function usePageAdLayout() {
  return useContext(PageAdLayoutContext);
}
