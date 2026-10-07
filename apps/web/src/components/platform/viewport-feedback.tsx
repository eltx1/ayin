"use client";

import { useEffect, useRef } from "react";

import { InstallUpdateController } from "@/components/pwa/install-update-controller";
import { useViewportBlockSize } from "@/lib/use-viewport-block-size";

import { NetworkStatusBanner } from "./network-status-banner";

/** A shared, scrollable feedback dock keeps optional prompts clear of navigation. */
export function ViewportFeedback() {
  const dock = useRef<HTMLDivElement>(null);
  useViewportBlockSize(dock, "--ayin-feedback-height");
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const measure = () => {
      // Pinch zoom owns its own viewport. Do not move UI while the user magnifies it.
      const unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.01;
      const height = unzoomed && viewport ? viewport.height : window.innerHeight;
      const bottom =
        unzoomed && viewport
          ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
          : 0;
      root.style.setProperty("--ayin-visual-height", `${height}px`);
      root.style.setProperty(
        "--ayin-visual-top",
        `${unzoomed && viewport ? viewport.offsetTop : 0}px`,
      );
      root.style.setProperty("--ayin-visual-bottom", `${bottom}px`);
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--ayin-visual-height");
      root.style.removeProperty("--ayin-visual-top");
      root.style.removeProperty("--ayin-visual-bottom");
    };
  }, []);
  return (
    <div className="ayin-feedback-dock" data-ayin-feedback-dock ref={dock}>
      <NetworkStatusBanner />
      <InstallUpdateController />
    </div>
  );
}
