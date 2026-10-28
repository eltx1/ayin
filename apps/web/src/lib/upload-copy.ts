import type { Locale } from "./i18n/config";
const arabic: Record<string, string> = {
  "Keep this page open until the upload finishes. You can edit the details below.":
    "أبقِ هذه الصفحة مفتوحة حتى يكتمل الرفع. يمكنك تعديل التفاصيل أدناه.",
  "Check your video details": "راجع تفاصيل الفيديو",
  "Details were not saved": "لم تُحفظ التفاصيل",
  "Thumbnail was not saved": "لم تُحفظ الصورة المصغرة",
  "Video was not published": "لم يُنشر الفيديو",
  "Upload needs attention": "الرفع يحتاج إلى إجراء",
  "Upload paused. Keep this page open to continue from this file.":
    "تم إيقاف الرفع مؤقتًا. أبقِ هذه الصفحة مفتوحة لاستكمال رفع الملف.",
  "Choose a video file": "اختر ملف فيديو",
  "This file cannot be uploaded yet": "تعذر بدء رفع هذا الملف",
  "Choose a supported video": "اختر فيديو بصيغة مدعومة",
  "Video processing needs attention": "تجهيز الفيديو يحتاج إلى إجراء",
  "Could not check processing": "تعذر التحقق من حالة التجهيز",
  "Your upload is saved. Retry the status check; you do not need to upload the file again.":
    "تم حفظ الملف المرفوع. أعد التحقق من الحالة؛ لا تحتاج إلى رفع الملف مرة أخرى.",
  "Needs attention": "يحتاج إلى إجراء",
  Paused: "متوقف مؤقتًا",
  "Current upload": "الرفع الحالي",
  "Checking file": "جارٍ فحص الملف",
  "Starting upload": "جارٍ بدء الرفع",
  "Confirming upload": "جارٍ تأكيد الرفع",
  Reconnecting: "جارٍ إعادة الاتصال",
  Upload: "رفع الملف",
  "Prepare playback": "تجهيز المشاهدة",
  Publish: "النشر",
  "Video transfer progress": "تقدم نقل ملف الفيديو",
  About: "حوالي",
  "min left": "دقيقة متبقية",
  "This action needs checking": "يلزم التحقق من نتيجة هذا الإجراء",
  "Continue upload": "استكمال الرفع",
  "Retry this upload": "إعادة محاولة هذا الرفع",
  "Pause upload": "إيقاف الرفع مؤقتًا",
  "Choose another file": "اختيار ملف آخر",
  "Sign in in a new tab": "تسجيل الدخول في تبويب جديد",
  "I have signed in — continue": "سجلت الدخول — استكمال",
  "Upload in progress": "جارٍ الرفع",
  "Maximum file size": "الحد الأقصى لحجم الملف",
  "Available storage": "المساحة المتاحة",
  "You can edit the details while the video uploads. Save or publish after upload finishes.":
    "يمكنك تعديل التفاصيل أثناء الرفع. احفظها أو انشر الفيديو بعد اكتمال الرفع.",
  "Your file is uploaded. Publishing becomes available when playback is ready.":
    "اكتمل رفع الملف. سيتاح النشر بعد تجهيز نسخة المشاهدة.",
  "The final confirmation did not arrive. Retry to check and finish this same upload.":
    "لم يصل التأكيد النهائي. أعد المحاولة للتحقق وإكمال نفس الرفع.",
  "Your connection was interrupted. Retry to continue this upload without creating another video.":
    "انقطع الاتصال. أعد المحاولة لاستكمال نفس الرفع دون إنشاء فيديو آخر.",
  "We could not confirm whether the upload was saved. Check your saved videos before starting another upload.":
    "تعذر تأكيد حفظ الرفع. راجع فيديوهاتك المحفوظة قبل بدء رفع آخر.",
  "Video uploads are temporarily unavailable. Please try again later.":
    "رفع الفيديو غير متاح مؤقتًا. حاول مرة أخرى لاحقًا.",
  "This file is larger than the upload limit shown below. Choose a smaller file.":
    "حجم الملف أكبر من الحد الموضح أدناه. اختر ملفًا أصغر.",
  "Your channel does not have enough storage for this video. Review saved videos in Studio.":
    "المساحة المتاحة بقناتك لا تكفي لهذا الفيديو. راجع فيديوهاتك المحفوظة في الاستوديو.",
  "This upload session expired. Review the saved draft in Studio before starting again.":
    "انتهت صلاحية جلسة الرفع. راجع المسودة المحفوظة في الاستوديو قبل البدء مجددًا.",
  "Your administrator session needs verification. Open Studio to verify and review this draft.":
    "تحتاج جلسة المسؤول إلى التحقق. افتح الاستوديو للتحقق ومراجعة هذه المسودة.",
  "Your session ended. Keep this page open, sign in in a new tab, then return here to retry.":
    "انتهت جلسة دخولك. أبقِ هذه الصفحة مفتوحة وسجل الدخول في تبويب جديد، ثم ارجع هنا لإعادة المحاولة.",
  "Sign in to the account that started this upload, then retry from this page.":
    "سجل الدخول بالحساب الذي بدأ هذا الرفع، ثم أعد المحاولة من هذه الصفحة.",
  "You no longer have permission to upload to this channel.":
    "لم تعد لديك صلاحية الرفع إلى هذه القناة.",
  "Too many upload requests. Wait a moment before trying again.":
    "طلبات الرفع كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  "Storage rejected the transfer. Retry to refresh the upload connection; your saved draft will be reused.":
    "رفضت خدمة التخزين نقل الملف. أعد المحاولة لتجديد الاتصال واستكمال نفس المسودة المحفوظة.",
  "The file transfer stopped after automatic retries. Check your connection, then retry this upload.":
    "توقف نقل الملف بعد المحاولات التلقائية. تحقق من اتصالك ثم أعد محاولة نفس الرفع.",
  "Your video is still processing. You can keep this page open or return to Studio later.":
    "لا يزال الفيديو قيد التجهيز. يمكنك إبقاء الصفحة مفتوحة أو العودة إلى الاستوديو لاحقًا.",
  "Upload a video": "رفع فيديو",
  "Choose a format and file, review the details, then save or publish your video.":
    "اختر نوع الفيديو والملف، ثم راجع التفاصيل واحفظها أو انشر الفيديو.",
  "Creator upload": "رفع الفيديو",
  "Bring your next video to AYIN.": "ارفع فيديوك القادم على AYIN",
  "Choose the experience, add your file, and publish from one focused workspace. AYIN checks compatibility and prepares reliable playback automatically.":
    "اختر نوع الفيديو وأضف الملف، ثم راجع التفاصيل وانشره. يتحقق AYIN من توافق الملف ويجهز نسخة مناسبة للمشاهدة.",
  "Upload workflow": "خطوات رفع الفيديو",
  "Direct upload": "رفع مباشر",
  "Compatibility check": "فحص التوافق",
  "Playback processing": "تجهيز المشاهدة",
  "Choose the viewing experience": "اختر نوع الفيديو",
  "Pick how this upload should appear across AYIN before selecting the file.":
    "حدد طريقة عرض الفيديو قبل اختيار الملف.",
  "Video format": "نوع الفيديو",
  "Standard video": "فيديو عادي",
  "Full videos, episodes, tutorials and long-form stories.":
    "فيديوهات كاملة وحلقات وشروحات وقصص طويلة.",
  "Landscape + flexible": "أفقي أو أبعاد أخرى",
  "AYIN Clip": "مقطع AYIN",
  "Fast, vertical-first videos built for the Clips feed.": "فيديوهات قصيرة رأسية لصفحة المقاطع.",
  "Vertical-first": "رأسي",
  "Add your video": "أضف الفيديو",
  "Drag it here on desktop or open your library on mobile.": "اسحب الملف هنا أو اختره من جهازك.",
  "File selected": "تم اختيار الملف",
  "Drop your video here": "أفلت الفيديو هنا",
  "Select a video to upload": "اختر فيديو لرفعه",
  "Drag & drop a file here, or browse your device.": "اسحب الملف وأفلته هنا أو اختره من جهازك.",
  "Preparing your creator workspace…": "جارٍ تحميل مساحة المنشئ…",
  "Checking…": "جارٍ الفحص…",
  "Choose another": "اختر ملفًا آخر",
  "Browse video": "اختيار فيديو",
  "MP4, MOV, MKV, WebM and other common video formats": "MP4 وMOV وMKV وWebM وصيغ الفيديو الشائعة",
  "Finish your video": "أكمل تفاصيل الفيديو",
  "Review the essentials while AYIN completes the upload and playback preparation.":
    "راجع التفاصيل أثناء رفع الملف وتجهيز نسخة المشاهدة.",
  Title: "العنوان",
  "Give your video a clear title": "اكتب عنوانًا واضحًا للفيديو",
  "Upload status": "حالة الرفع",
  "Ready to publish": "جاهز للنشر",
  "Upload complete": "اكتمل الرفع",
  "Last checked stage": "المرحلة عند آخر تحقق",
  "Preparing source": "جارٍ تجهيز الملف الأصلي",
  "Checking source": "جارٍ فحص الملف الأصلي",
  "Preparing playback": "جارٍ تجهيز المشاهدة",
  "Saving playback": "جارٍ حفظ نسخة المشاهدة",
  "Checking playback": "جارٍ فحص نسخة المشاهدة",
  "Preparing preview": "جارٍ تجهيز الصورة المصغرة",
  "Finishing checks": "جارٍ إكمال الفحوص",
  "Checking availability": "جارٍ التحقق من جاهزية المشاهدة",
  "Waiting for status": "في انتظار تحديث الحالة",
  "Uploading video": "جارٍ رفع الفيديو",
  "Upload progress": "تقدم الرفع",
  "Advanced settings": "إعدادات إضافية",
  "Optional metadata, publishing controls and thumbnail · SEO stays automatic":
    "بيانات إضافية وخيارات النشر والصورة المصغرة",
  Description: "الوصف",
  "Tell viewers what this video is about": "اشرح للمشاهدين محتوى الفيديو",
  Visibility: "إتاحة الفيديو",
  Public: "عام",
  Unlisted: "غير مدرج",
  Private: "خاص",
  Schedule: "موعد النشر",
  "Allow comments": "السماح بالتعليقات",
  Thumbnail: "الصورة المصغرة",
  "Thumbnail suggestions appear when they are available.": "ستظهر اقتراحات الصور عند توفرها.",
  "Custom thumbnail saved": "تم حفظ الصورة المخصصة",
  "Upload a custom JPG or PNG": "اختر صورة JPG أو PNG",
  "By publishing, you confirm that you own this video or have all rights and permissions required to publish it on AYIN.":
    "بالنشر، تؤكد أنك تملك الفيديو أو لديك جميع الحقوق والتصاريح اللازمة لنشره على AYIN.",
  "Save details": "حفظ التفاصيل",
  Published: "تم النشر",
  "Publishing…": "جارٍ النشر…",
  "Publish video": "نشر الفيديو",
  Ready: "جاهز",
  Queued: "في الانتظار",
  Processing: "جارٍ التجهيز",
  Failed: "تعذر التجهيز",
  Cancelled: "أُلغي التجهيز",
  "Not started": "لم يبدأ",
  "Your video is uploading…": "جارٍ رفع الفيديو…",
  "Upload and processing complete. Your video is ready to publish.":
    "اكتمل الرفع والتجهيز. الفيديو جاهز للنشر.",
  "Upload complete. AYIN is preparing a reliable playback version in the background.":
    "اكتمل الرفع. يجري AYIN تجهيز نسخة مناسبة للمشاهدة.",
  "Drop one supported video file to start an upload.":
    "اسحب ملف فيديو واحدًا بصيغة مدعومة لبدء الرفع.",
  "Processing complete. This video is ready to publish.": "اكتمل التجهيز. الفيديو جاهز للنشر.",
  "Playback preparation was still pending at the last check. Automatic checks are paused; check again for an update.":
    "لم يكتمل تجهيز المشاهدة عند آخر تحقق. توقفت عمليات التحقق التلقائية؛ تحقق مجددًا لمعرفة آخر تحديث.",
  "Processing failed. Your video remains saved in Studio; review its status before publishing.":
    "تعذر تجهيز الفيديو. يظل الفيديو محفوظًا في الاستوديو؛ راجع حالته قبل النشر.",
  "Processing was cancelled. Your video remains saved in Studio; review its status before publishing.":
    "أُلغي تجهيز الفيديو. يظل الفيديو محفوظًا في الاستوديو؛ راجع حالته قبل النشر.",
  "Processing status is temporarily unavailable. Retry checking its status.":
    "تعذر تحميل حالة التجهيز مؤقتًا. أعد التحقق من الحالة.",
  "Check the title, schedule and advanced metadata before saving.":
    "راجع العنوان وموعد النشر والبيانات الإضافية قبل الحفظ.",
  "Video details saved.": "تم حفظ تفاصيل الفيديو.",
  "The save response could not be confirmed. Review this draft in Studio before writing again.":
    "تعذر تأكيد نتيجة الحفظ. راجع المسودة في الاستوديو قبل إجراء تعديل آخر.",
  "Choose a JPG or PNG thumbnail up to 5 MB.": "اختر صورة JPG أو PNG بحجم لا يتجاوز ٥ ميجابايت.",
  "Thumbnail saved.": "تم حفظ الصورة المصغرة.",
  "The thumbnail response could not be confirmed. Review this draft in Studio before writing again.":
    "تعذر تأكيد حفظ الصورة. راجع المسودة في الاستوديو قبل إجراء تعديل آخر.",
  "Check the title, schedule and advanced metadata before publishing.":
    "راجع العنوان وموعد النشر والبيانات الإضافية قبل النشر.",
  "Video scheduled. Opening your Studio content…": "تمت جدولة الفيديو. جارٍ فتح محتوى الاستوديو…",
  "Published privately. Opening your Studio content…":
    "نُشر الفيديو بشكل خاص. جارٍ فتح محتوى الاستوديو…",
  "Published. Opening your video…": "تم النشر. جارٍ فتح الفيديو…",
  "Publication could not be confirmed. Review this video's status in Studio before publishing again.":
    "تعذر تأكيد نتيجة النشر. راجع حالة الفيديو في الاستوديو قبل النشر مجددًا.",
  "Upload could not be confirmed. Review your saved uploads in Studio before starting again.":
    "تعذر تأكيد الرفع. راجع فيديوهاتك المحفوظة في الاستوديو قبل البدء مجددًا.",
  "The upload response could not be verified. Review this upload in Studio before trying again.":
    "تعذر التحقق من رد الرفع. راجع الفيديو في الاستوديو قبل المحاولة مجددًا.",
  "Your creator workspace could not be loaded.": "تعذر تحميل مساحة المنشئ.",
  "Retry loading workspace": "إعادة تحميل المساحة",
  "Manage saved videos": "إدارة الفيديوهات المحفوظة",
  "Review saved uploads in Studio": "مراجعة الفيديوهات المحفوظة في الاستوديو",
  " · The last response is uncertain; further writes are paused.":
    " · لم تتأكد نتيجة الطلب الأخير؛ تم إيقاف التعديلات التالية.",
  "Check processing status": "التحقق من حالة التجهيز",
  "Checking processing status…": "جارٍ التحقق من حالة التجهيز…",
  "Leave this upload? Unsaved changes and local file progress will be lost. Saved drafts remain in Studio.":
    "هل تريد مغادرة صفحة الرفع؟ ستفقد التعديلات غير المحفوظة وتقدم الملف المحلي. تظل المسودات المحفوظة في الاستوديو.",
  "Finalizing upload…": "جارٍ تأكيد الرفع…",
  "Connection paused. Retrying the upload safely…": "توقف الاتصال. جارٍ إعادة إرسال الجزء بأمان…",
  "Uploading video…": "جارٍ رفع الفيديو…",
  Tags: "الوسوم",
  "Up to 20 tags, 40 characters each. Separate tags with commas.":
    "حتى ٢٠ وسمًا، و٤٠ حرفًا لكل وسم. افصل الوسوم بفواصل.",
  Category: "التصنيف",
  "Not set": "غير محدد",
  Entertainment: "ترفيه",
  Education: "تعليم",
  Gaming: "ألعاب",
  Music: "موسيقى",
  News: "أخبار",
  Sports: "رياضة",
  Technology: "تقنية",
  Lifestyle: "أسلوب حياة",
  "Film & animation": "أفلام ورسوم متحركة",
  Other: "أخرى",
  "Primary language": "اللغة الرئيسية",
  "Recording date": "تاريخ التسجيل",
  "Content type": "نوع المحتوى",
  "Creator video (default)": "فيديو منشئ (افتراضي)",
  Movie: "فيلم",
  Documentary: "وثائقي",
  "Rights basis": "أساس حقوق النشر",
  "Standard authorization": "التصريح المعتاد",
  "I own it": "أملك المحتوى",
  Licensed: "مرخص",
  Authorized: "مصرح به",
  "Public domain": "ملكية عامة",
  "Rights note": "ملاحظة الحقوق",
  "Optional license or rights note": "ملاحظة اختيارية حول الترخيص أو الحقوق",
  "Rights expiration": "انتهاء الحقوق",
  "Optional distribution-rights expiry. Channel owner only in Studio.":
    "موعد اختياري لانتهاء حقوق التوزيع، يحدده مالك القناة.",
  "Series title": "السلسلة أو الحلقة",
  "Optional series title": "عنوان السلسلة (اختياري)",
  "Season number": "رقم الموسم",
  "Episode number": "رقم الحلقة",
  "Maturity level": "الفئة العمرية للمحتوى",
  General: "عام",
  Teen: "للمراهقين",
  Mature: "للبالغين",
  "Age restriction": "تقييد العمر",
  "None (default)": "بلا تقييد (افتراضي)",
  "13 and older": "١٣ عامًا فأكثر",
  "18 and older": "١٨ عامًا فأكثر",
  "Set the minimum audience age for this video.": "حدد الحد الأدنى لعمر جمهور الفيديو.",
  "Allowed territories": "الدول المسموح بها",
  "ISO two-letter country codes. Leave allowed and blocked lists empty for worldwide availability.":
    "رموز الدول من حرفين. اترك قائمتي السماح والحظر فارغتين للإتاحة عالميًا.",
  "Blocked territories": "الدول المحظورة",
  "Server-side playback, search, discovery, SEO and Creator TV all enforce these restrictions.":
    "تطبق هذه القيود على المشاهدة والبحث والاكتشاف وCreator TV.",
  "Custom chapters": "فصول الفيديو",
  "One chapter per line: MM:SS Title or HH:MM:SS Title. Starts must increase.":
    "فصل في كل سطر: MM:SS العنوان أو HH:MM:SS العنوان. رتب أوقات البداية تصاعديًا.",
  "Ad-break preference": "تفضيل فواصل الإعلانات",
  "Platform default": "إعداد المنصة الافتراضي",
  Automatic: "تلقائي",
  "No creator-requested breaks": "بدون فواصل يطلبها المنشئ",
  "Custom preferred offsets": "أوقات مفضلة مخصصة",
  "Custom ad-break offsets": "أوقات فواصل الإعلانات",
  "Preferred times in seconds from the start.": "الأوقات المفضلة بالثواني من بداية الفيديو.",
};
export function uploadText(value: string, locale: Locale): string {
  return locale === "ar" ? (arabic[value] ?? value) : value;
}
