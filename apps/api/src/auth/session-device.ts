export function describeSessionDevice(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /SamsungBrowser\//i.test(userAgent)
      ? "Samsung Internet"
      : /CriOS\//i.test(userAgent)
        ? "Chrome"
        : /FxiOS\//i.test(userAgent)
          ? "Firefox"
          : /Chrome\//i.test(userAgent)
            ? "Chrome"
            : /Firefox\//i.test(userAgent)
              ? "Firefox"
              : /Safari\//i.test(userAgent)
                ? "Safari"
                : /AYIN|SmartTV|SMART-TV|Tizen|Web0S|WebOS/i.test(userAgent)
                  ? "AYIN TV"
                  : "Browser";

  const device = /iPhone/i.test(userAgent)
    ? "iPhone"
    : /iPad/i.test(userAgent)
      ? "iPad"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? "macOS"
            : /Tizen|Web0S|WebOS|SmartTV|SMART-TV/i.test(userAgent)
              ? "Smart TV"
              : /Linux/i.test(userAgent)
                ? "Linux"
                : "unknown device";

  return `${browser} on ${device}`.slice(0, 160);
}
