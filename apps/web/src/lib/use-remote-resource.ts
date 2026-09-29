"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Loader<T> = (signal: AbortSignal) => Promise<T>;
export type RemoteResource<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: unknown };

// Pass a stable loader (module function or useCallback). No cache or write retry.
// Abort on reload immediately, not only when React later runs effect cleanup.
export function useRemoteResource<T>(load: Loader<T>) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ loader: Loader<T>; state: RemoteResource<T> }>({
    loader: load,
    state: { status: "loading" },
  });
  const active = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    active.current?.abort();
    setSnapshot({ loader: load, state: { status: "loading" } });
    setAttempt((value) => value + 1);
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    void Promise.resolve()
      .then(() => load(controller.signal))
      .then((data) => {
        if (!controller.signal.aborted)
          setSnapshot({ loader: load, state: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({ loader: load, state: { status: "error", error } });
      });
    return () => controller.abort();
  }, [load, attempt]);

  // A changed account/query loader never exposes the previous loader's snapshot.
  const state: RemoteResource<T> =
    snapshot.loader === load ? snapshot.state : { status: "loading" };
  return { state, reload };
}
