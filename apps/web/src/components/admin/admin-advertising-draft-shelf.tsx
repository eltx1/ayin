"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useAdminAccess } from "./admin-access";
import type { AdminScopeLease } from "@/lib/admin-session-scope";

type Pending = {
  target: string;
  status: "pending" | "verification" | "uncertain" | "acknowledged";
} | null;
type Retained = { values: Record<string, unknown>; pending: Pending };
type Shelf = {
  values: Record<string, unknown>;
  pending: Pending;
  failed: boolean;
  initial: <T>(key: string, value: () => T) => T;
  save: (key: string, value: unknown) => boolean;
  setPending: (pending: Pending) => boolean;
};
const Context = createContext<Shelf | null>(null);
const key = "advertising-editor";

function createShelf(
  retained: Retained,
  write: (value: Retained) => boolean,
  failed: boolean,
): Shelf {
  const persist = () => {
    failed = !write(retained);
    return !failed;
  };
  return {
    get values() {
      return retained.values;
    },
    get pending() {
      return retained.pending;
    },
    get failed() {
      return failed;
    },
    initial<T>(name: string, value: () => T): T {
      if (!Object.hasOwn(retained.values, name)) retained.values[name] = value();
      return retained.values[name] as T;
    },
    save(name, value) {
      retained.values[name] = value;
      return persist();
    },
    setPending(pending) {
      retained.pending = pending;
      return persist();
    },
  };
}

// A fixed, bounded slot in the existing AdminAccess coordinator. Drafts are
// destroyed by its identity/role/version/visibility rules; never browser storage.
export function AdvertisingDraftShelf({
  lease,
  children,
}: {
  lease: AdminScopeLease;
  children: ReactNode;
}) {
  const { getScopedDraft, getScopedDraftFailure, setScopedDraft } = useAdminAccess();
  const [shelf] = useState(() =>
    createShelf(
      getScopedDraft<Retained>(key, lease) ?? { values: {}, pending: null },
      (value) => setScopedDraft(key, value, lease),
      getScopedDraftFailure(key, lease),
    ),
  );
  return <Context.Provider value={shelf}>{children}</Context.Provider>;
}
export function useAdvertisingShelf() {
  const shelf = useContext(Context);
  if (!shelf) throw new Error("Advertising drafts require their Admin scope.");
  return shelf;
}
export function useAdvertisingDraft<T>(key: string, initial: T | (() => T)) {
  const shelf = useAdvertisingShelf();
  const [value, setValue] = useState<T>(() =>
    shelf.initial(key, () => (typeof initial === "function" ? (initial as () => T)() : initial)),
  );
  const current = useRef(value);
  const change = useCallback(
    (next: SetStateAction<T>) => {
      const value = typeof next === "function" ? (next as (value: T) => T)(current.current) : next;
      current.current = value;
      shelf.save(key, value);
      setValue(value);
    },
    [key, shelf],
  );
  return [value, change] as const;
}
