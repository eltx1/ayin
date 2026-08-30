"use client";

import { useEffect } from "react";

import { installTvPlatformRuntime } from "@/lib/tv-platform-runtime";

export function TvPlatformRuntime() {
  useEffect(() => installTvPlatformRuntime(), []);
  return null;
}
