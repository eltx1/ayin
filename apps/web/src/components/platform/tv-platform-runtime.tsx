"use client";

import { useEffect, useRef, useState } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import {
  canRequestTvExit,
  detectTvWebPlatform,
  installTvPlatformRuntime,
  requestTvExit,
} from "@/lib/tv-platform-runtime";

export function TvPlatformRuntime() {
  const [platform] = useState<ReturnType<typeof detectTvWebPlatform>>(() =>
    typeof window === "undefined" ? null : detectTvWebPlatform(),
  );
  const [offline, setOffline] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [hostedExitFallback, setHostedExitFallback] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updateNetwork = () => {
      if (platform === "tizen") setOffline(!navigator.onLine);
    };
    const frame = window.requestAnimationFrame(updateNetwork);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    const uninstallRuntime = installTvPlatformRuntime();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      uninstallRuntime();
    };
  }, [platform]);

  useEffect(() => {
    const onExitRequest = (event: Event) => {
      if (platform !== "tizen") return;
      event.preventDefault();
      setHostedExitFallback(false);
      setExitOpen(true);
    };
    window.addEventListener("ayin:tv-exit-request", onExitRequest);
    return () => window.removeEventListener("ayin:tv-exit-request", onExitRequest);
  }, [platform]);

  useEffect(() => {
    if (!exitOpen) return;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [exitOpen]);

  if (exitOpen) {
    return (
      <div
        aria-label="Exit AYIN"
        aria-modal="true"
        role="dialog"
        style={{
          alignItems: "center",
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          inset: 0,
          justifyContent: "center",
          position: "fixed",
          zIndex: 2147483647,
        }}
      >
        <TvFocusScope>
          <div
            style={{
              background: "#11131a",
              border: "2px solid rgba(255,255,255,0.22)",
              borderRadius: 18,
              color: "#fff",
              maxWidth: 620,
              padding: 32,
              width: "min(80vw, 620px)",
            }}
          >
            <h2 style={{ fontSize: 32, margin: "0 0 16px" }}>Exit AYIN?</h2>
            <p style={{ fontSize: 22, lineHeight: 1.5, margin: "0 0 24px" }}>
              {hostedExitFallback
                ? "This hosted TV runtime cannot close the app directly. Press and hold Return/Exit on the Samsung remote to close AYIN."
                : "Do you want to close AYIN?"}
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "flex-end" }}>
              <button
                data-tv-focus-id="tizen-exit-cancel"
                data-tv-focusable="true"
                onClick={() => {
                  setHostedExitFallback(false);
                  setExitOpen(false);
                }}
                ref={cancelRef}
                style={{ fontSize: 22, minHeight: 56, minWidth: 140 }}
                type="button"
              >
                {hostedExitFallback ? "OK" : "No"}
              </button>
              {!hostedExitFallback ? (
                <button
                  data-tv-focus-id="tizen-exit-confirm"
                  data-tv-focusable="true"
                  onClick={() => {
                    if (canRequestTvExit() && requestTvExit()) {
                      setExitOpen(false);
                      return;
                    }
                    setHostedExitFallback(true);
                  }}
                  style={{ fontSize: 22, minHeight: 56, minWidth: 140 }}
                  type="button"
                >
                  Yes
                </button>
              ) : null}
            </div>
          </div>
        </TvFocusScope>
      </div>
    );
  }

  if (platform === "tizen" && offline) {
    return (
      <div
        aria-live="assertive"
        role="alert"
        style={{
          background: "#11131a",
          border: "2px solid rgba(255,255,255,0.3)",
          borderRadius: 16,
          bottom: 32,
          color: "#fff",
          fontSize: 22,
          left: "50%",
          maxWidth: 760,
          padding: "20px 28px",
          position: "fixed",
          transform: "translateX(-50%)",
          width: "min(86vw, 760px)",
          zIndex: 2147483646,
        }}
      >
        Network connection lost. AYIN will reconnect when the TV is online.
      </div>
    );
  }

  return null;
}
