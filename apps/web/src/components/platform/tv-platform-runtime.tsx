"use client";

import { useEffect, useRef, useState } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import {
  detectTvWebPlatform,
  installTvPlatformRuntime,
  requestTvExit,
} from "@/lib/tv-platform-runtime";

export function TvPlatformRuntime() {
  const [exitOpen, setExitOpen] = useState(false);
  const [exitUnavailable, setExitUnavailable] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => installTvPlatformRuntime(), []);

  useEffect(() => {
    const onExitRequest = () => {
      if (detectTvWebPlatform() !== "tizen") return;
      setExitUnavailable(false);
      setExitOpen(true);
    };
    window.addEventListener("ayin:tv-exit-request", onExitRequest);
    return () => window.removeEventListener("ayin:tv-exit-request", onExitRequest);
  }, []);

  useEffect(() => {
    if (!exitOpen) return;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [exitOpen]);

  if (!exitOpen) return null;

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
          {exitUnavailable
            ? "This hosted Samsung TV build cannot call the Tizen exit API. Press and hold Return/Exit to close AYIN."
            : "Do you want to close AYIN?"}
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "flex-end" }}>
          <button
            data-tv-focus-id="tizen-exit-cancel"
            data-tv-focusable="true"
            onClick={() => {
              setExitUnavailable(false);
              setExitOpen(false);
            }}
            ref={cancelRef}
            style={{ fontSize: 22, minHeight: 56, minWidth: 140 }}
            type="button"
          >
            No
          </button>
          <button
            data-tv-focus-id="tizen-exit-confirm"
            data-tv-focusable="true"
            onClick={() => {
              if (requestTvExit()) {
                setExitOpen(false);
                return;
              }
              setExitUnavailable(true);
            }}
            style={{ fontSize: 22, minHeight: 56, minWidth: 140 }}
            type="button"
          >
            Yes
          </button>
          </div>
        </div>
      </TvFocusScope>
    </div>
  );
}
