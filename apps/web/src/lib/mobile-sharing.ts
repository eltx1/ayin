import { requestMobile, supportsMobile, validMobileShareUrl } from "./mobile-bridge";

/** Shares public destinations only, never account/session query strings. */
export async function sharePublicUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin || url.username || url.password) return false;
  const kids = url.searchParams.getAll("kids"),
    lang = url.searchParams.getAll("lang");
  url.search = "";
  url.hash = "";
  if (kids.length === 1 && kids[0] === "1") url.searchParams.set("kids", "1");
  if (lang.length === 1 && ["en", "ar"].includes(lang[0]!)) url.searchParams.set("lang", lang[0]!);
  if (!validMobileShareUrl("https://ayin.stream" + url.pathname + url.search)) return false;
  if (supportsMobile("share") && validMobileShareUrl(url.href)) {
    try {
      return (
        (await requestMobile<{ shared: boolean }>("share.open", { url: url.href }))?.shared === true
      );
    } catch {
      return false;
    } // Native cancellation must not fall through into a second dialog.
  }
  if (url.origin !== window.location.origin) return false;
  if (navigator.share) {
    try {
      await navigator.share({ url: url.href });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }
  await navigator.clipboard.writeText(url.href);
  return true;
}
