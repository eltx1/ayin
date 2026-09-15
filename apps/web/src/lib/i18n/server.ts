import { headers } from "next/headers";

import { defaultLocale, isLocale, requestLocaleHeader, type Locale } from "./config";

export async function getRequestLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const value = requestHeaders.get(requestLocaleHeader);
  return isLocale(value) ? value : defaultLocale;
}
