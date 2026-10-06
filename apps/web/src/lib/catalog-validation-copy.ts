/** Existing API validation codes only; this is presentation, never publication policy. */
const reasons: Record<string, readonly [string, string]> = {
  TITLE_REQUIRED: ["Add a title.", "أضف عنوانًا."],
  SAFE_SLUG_REQUIRED: ["Use a valid URL slug.", "استخدم اسم رابط صالحًا."],
  INVALID_SLUG: ["Use a valid URL slug.", "استخدم اسم رابط صالحًا."],
  SYNOPSIS_REQUIRED: ["Add a synopsis.", "أضف ملخصًا."],
  RELEASE_YEAR_INVALID: ["Enter a valid release year.", "أدخل سنة إصدار صالحة."],
  RUNTIME_INVALID: ["Enter a valid runtime in minutes.", "أدخل مدة صالحة بالدقائق."],
  MATURITY_REQUIRED: ["Set a maturity rating.", "حدّد التصنيف العمري."],
  ORIGINAL_LANGUAGE_REQUIRED: ["Set the original language.", "حدّد اللغة الأصلية."],
  LANGUAGE_REQUIRED: ["Set the original language.", "حدّد اللغة الأصلية."],
  GENRE_REQUIRED: ["Add at least one genre or category.", "أضف نوعًا أو فئة واحدة على الأقل."],
  POSTER_REQUIRED: ["Choose a validated poster image.", "اختر صورة ملصق متحققًا منها."],
  PRIMARY_VIDEO_REQUIRED: [
    "Choose the movie’s primary playback video.",
    "اختر الفيديو الأساسي لتشغيل الفيلم.",
  ],
  PRIMARY_VIDEO_NOT_PUBLISHED: [
    "Publish the primary video or choose a published video.",
    "انشر الفيديو الأساسي أو اختر فيديو منشورًا.",
  ],
  PRIMARY_VIDEO_NOT_PUBLIC: [
    "Choose a primary video that is publicly available.",
    "اختر فيديو أساسيًا متاحًا للجمهور.",
  ],
  PRIMARY_VIDEO_UNAVAILABLE: [
    "The primary video is unavailable. Choose an accessible, validated video.",
    "الفيديو الأساسي غير متاح. اختر فيديو متاحًا ومتحققًا منه.",
  ],
  TRAILER_VIDEO_UNAVAILABLE: [
    "The trailer is unavailable. Replace or clear its selection.",
    "الإعلان التشويقي غير متاح. استبدله أو امسح اختياره.",
  ],
  ACTIVE_RIGHTS_REQUIRED: [
    "Add an active availability rule that allows viewing.",
    "أضف قاعدة إتاحة سارية تسمح بالمشاهدة.",
  ],
  PUBLISHED_EPISODE_REQUIRED: [
    "Publish at least one episode with a public video.",
    "انشر حلقة واحدة على الأقل مرتبطة بفيديو عام.",
  ],
  PLAYABLE_PUBLISHED_EPISODE_REQUIRED: [
    "A published episode needs an accessible, validated playback video.",
    "تحتاج حلقة منشورة إلى فيديو تشغيل متاح ومتحقق منه.",
  ],
  ACTIVE_AVAILABILITY_REQUIRED: [
    "Review the availability rules and their dates.",
    "راجع قواعد الإتاحة وتواريخها.",
  ],
  VIDEO_REQUIRED: ["Choose a playback video for this episode.", "اختر فيديو تشغيل لهذه الحلقة."],
  VIDEO_UNAVAILABLE: [
    "The episode video is unavailable. Choose an accessible, validated video.",
    "فيديو الحلقة غير متاح. اختر فيديو متاحًا ومتحققًا منه.",
  ],
};
export function catalogValidationReason(code: string, locale: string): string {
  return (
    reasons[code]?.[locale === "ar" ? 1 : 0] ??
    (locale === "ar"
      ? "تعذر اجتياز فحص نشر إضافي. راجع التفاصيل التشخيصية."
      : "An additional publication check failed. Review diagnostic details.")
  );
}
export const catalogValidationCodes = Object.keys(reasons);
