"use client";

import { useEffect, useRef, useState } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import {
  installTvPlatformRuntime,
  requestTvExit,
  type TvExitRequestDetail,
} from "@/lib/tv-platform-runtime";

export function TvPlatformRuntime() {
  const [exitOpen, setExitOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => installTvPlatformRuntime(), []);

  useEffect(() => {
    const onExitRequest = (event: CustomEvent<TvExitRequestDetail>) => {
      if (event.detail.platform !== "tizen") return;
      setExitOpen(true);
    };
    window.addEventListener("ayin:tv-exit-request", onExitRequest);
    return () => window.removeEventListener("ayin:tv-exit-request", onExitRequest);
  }, []);

  useEffect(() => {
    if (!exitOpen) return;
    const frame = window.requestAnimationFrame(() => {
      cancelRef.current?.focus({ preventScroll: true });
    });
    const onRemote = (event: CustomEvent<{ key: string }>) => {
      if (event.detail.key !== "BACK") return;
      event.preventDefault();
      setExitOpen(false);
    };
    window.addEventListener("ayin:native-remote", onRemote);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("ayin:native-remote", onRemote);
    };
  }, [exitOpen]);

  if (!exitOpen) return null;

  return (
    <>
      {exitOpen ? (
        <div
          aria-label="Exit AYIN"
          aria-modal="true"
          role="dialog"
          style={{
            alignItems: "center",
            background: "rgba(3,3,10,0.82)",
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
                background: "#11121a",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 18,
                boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
                color: "#fff",
                maxWidth: 560,
                padding: 32,
                width: "min(82vw,560px)",
              }}
            >
              <h2 style={{ fontSize: 30, margin: "0 0 12px" }}>Exit AYIN?</h2>
              <p style={{ fontSize: 20, lineHeight: 1.45, margin: "0 0 28px", opacity: 0.82 }}>
                Do you want to close AYIN and return to Samsung TV?
              </p>
              <div style={{ display: "flex", gap: 16, justifyContent: "flex-end" }}>
                <button
                  data-tv-focus-id="tizen-exit-cancel"
                  data-tv-focusable="true"
                  onClick={() => setExitOpen(false)}
                  ref={cancelRef}
                  style={buttonStyle}
                  type="button"
                >
                  Stay
                </button>
                <button
                  data-tv-focus-id="tizen-exit-confirm"
                  data-tv-focusable="true"
                  onClick={() => {
                    if (!requestTvExit()) setExitOpen(false);
                  }}
                  style={buttonStyle}
                  type="button"
                >
                  Exit
                </button>
              </div>
            </div>
          </TvFocusScope>
        </div>
      ) : null}
    </>
  );
}

const buttonStyle = {
  background: "#fff",
  border: 0,
  borderRadius: 12,
  color: "#03030a",
  cursor: "pointer",
  fontSize: 20,
  fontWeight: 700,
  minWidth: 130,
  padding: "14px 20px",
} as const;
