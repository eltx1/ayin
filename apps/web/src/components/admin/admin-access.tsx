"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { parseAdminSession } from "@/lib/admin-dashboard";
import { getAdminSession, type AdminSession } from "@/lib/admin-control";

interface Access {
  session: AdminSession | null;
  error: string;
  loading: boolean;
  refresh: () => void;
}
const Context = createContext<Access | null>(null);

export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    session: AdminSession | null;
    error: string;
  } | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void getAdminSession(controller.signal)
      .then((value) => {
        const session = parseAdminSession(value);
        if (!controller.signal.aborted) setResult({ revision, session, error: "" });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            revision,
            session: null,
            error: cause instanceof Error ? cause.message : "Admin access unavailable.",
          });
      });
    return () => controller.abort();
  }, [revision]);
  const current = result?.revision === revision ? result : null;
  return (
    <Context.Provider
      value={{
        session: current?.session ?? null,
        error: current?.error ?? "",
        loading: current === null,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAdminAccess() {
  const context = useContext(Context);
  if (!context) throw new Error("Admin access requires the Admin layout.");
  return context;
}
