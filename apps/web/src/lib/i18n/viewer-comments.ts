import type { Locale } from "./config";
import { viewerCommentsAr, viewerCommentsEn } from "./resources/viewer-comments";
export type ViewerCommentKey = keyof typeof viewerCommentsEn;
export function translateViewerComment(
  locale: Locale,
  key: ViewerCommentKey,
  count?: string,
): string {
  return (locale === "ar" ? viewerCommentsAr : viewerCommentsEn)[key].replace(
    "{count}",
    count ?? "",
  );
}
