export const AYIN_WEBOS_MIN_SUPPORTED_RELEASE = 25;
export const AYIN_WEBOS_MIN_CHROMIUM_MAJOR = 120;
export const AYIN_WEBOS_CURRENT_SUPPORTED_RELEASES = ["25", "26"] as const;

declare global {
  interface Window {
    webOS?: unknown;
  }
}

export function parseLgWebOsChromiumMajor(userAgent: string): number | null {
  if (!/\bWeb0S\b/iu.test(userAgent) || !/\bWebAppManager\b/iu.test(userAgent)) {
    return null;
  }
  const match = /\bChrome\/(\d+)/iu.exec(userAgent);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSupportedLgWebOsRuntime(userAgent: string): boolean {
  const chromiumMajor = parseLgWebOsChromiumMajor(userAgent);
  return chromiumMajor !== null && chromiumMajor >= AYIN_WEBOS_MIN_CHROMIUM_MAJOR;
}

export function isCanonicalHostedWebOs(target: Window): boolean {
  try {
    const url = new URL(target.location.href);
    return (
      url.protocol === "https:" &&
      url.hostname === "ayin.stream" &&
      url.searchParams.get("platform") === "webos" &&
      url.searchParams.get("hosted") === "1"
    );
  } catch {
    return false;
  }
}

export function detectWebOsRuntime(target: Window): boolean {
  return (
    Boolean(target.webOS) ||
    parseLgWebOsChromiumMajor(target.navigator.userAgent) !== null ||
    isCanonicalHostedWebOs(target)
  );
}

export function requestWebOsExit(target: Window): boolean {
  if (!detectWebOsRuntime(target)) return false;
  try {
    target.close();
    return true;
  } catch {
    return false;
  }
}
