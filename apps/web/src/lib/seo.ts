import type { Metadata } from "next";

import { mediaAssetUrl } from "@/lib/channel";

export const AYIN_SITE_URL = normalizeOrigin(
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_WEB_BASE_URL ?? "https://ayin.stream",
);
export const AYIN_NAME = "AYIN";
export const AYIN_DEFAULT_DESCRIPTION =
  "Watch creator videos, streaming, playlists and connected-TV experiences on AYIN.";
export const AYIN_DEFAULT_IMAGE = `${AYIN_SITE_URL}/brand/ayin-logo.png`;

export function absoluteUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${AYIN_SITE_URL}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function mediaSeoUrl(objectKey: string | null | undefined): string | null {
  return mediaAssetUrl(objectKey);
}

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function seoDescription(
  value: string | null | undefined,
  fallback: string,
  maxLength = 160,
): string {
  const source = cleanText(value) || cleanText(fallback) || AYIN_DEFAULT_DESCRIPTION;
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength - 1).trimEnd()}…`;
}

export function isoDuration(milliseconds: number | null | undefined): string | undefined {
  if (!milliseconds || milliseconds <= 0) return undefined;
  let seconds = Math.max(1, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${seconds}S`;
}

export function metadataRobots(indexable: boolean): Metadata["robots"] {
  return indexable
    ? {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          "max-video-preview": -1,
        },
      }
    : {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
      };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}
