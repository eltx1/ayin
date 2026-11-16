import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { localizePath } from "@/lib/i18n/routing";
import styles from "@/components/legal/legal-page.module.css";

export function PublicSafetyHelp({
  kind,
  locale,
}: {
  kind: "deletion" | "support";
  locale: Locale;
}) {
  const ar = locale === "ar",
    deletion = kind === "deletion";
  const copy = (en: string, arabic: string) => (ar ? arabic : en);
  const href = (path: string) => localizePath(path, locale);
  return (
    <main className={styles.page} lang={locale} dir={ar ? "rtl" : "ltr"}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>AYIN · {copy("Help and safety", "المساعدة والسلامة")}</p>
        <h1 className={styles.title}>
          {deletion
            ? copy("Delete your AYIN account", "حذف حسابك في AYIN")
            : copy("AYIN support and safety", "دعم AYIN والسلامة")}
        </h1>
        <div className={styles.intro}>
          <p>
            {copy(
              "AYIN is a Horus Media product. You can use this website without installing the app.",
              "AYIN أحد منتجات Horus Media. يمكنك استخدام هذا الموقع دون تثبيت التطبيق.",
            )}
          </p>
        </div>
      </header>
      {deletion ? (
        <>
          <section className={styles.section}>
            <h2>
              {copy(
                "Request account and associated data deletion",
                "طلب حذف الحساب والبيانات المرتبطة",
              )}
            </h2>
            <ol style={{ paddingInlineStart: "1.3rem", paddingInlineEnd: 0 }}>
              <li>
                {copy(
                  "Sign in to the AYIN account you want to delete, then open Account → Privacy and data.",
                  "سجّل الدخول إلى حساب AYIN الذي تريد حذفه، ثم افتح الحساب ← الخصوصية والبيانات.",
                )}
              </li>
              <li>
                {copy(
                  "You may download your data first. Review the deletion explanation and enter your current password and the confirmation phrase shown in the form.",
                  "يمكنك تنزيل بياناتك أولًا. راجع شرح الحذف وأدخل كلمة المرور الحالية وعبارة التأكيد الظاهرة في النموذج.",
                )}
              </li>
              <li>
                {copy(
                  "Submit the deletion request. Read its status and the displayed dates; deletion is not confirmed merely by closing or uninstalling the app.",
                  "أرسل طلب الحذف، ثم راجع حالته والتواريخ المعروضة. إغلاق التطبيق أو إلغاء تثبيته لا يعني حذف الحساب.",
                )}
              </li>
            </ol>
            <p>
              <Link href={href("/account#privacy-data-title")}>
                {copy("Open account deletion controls", "فتح إعدادات حذف الحساب")}
              </Link>
            </p>
          </section>
          <section className={styles.section}>
            <h2>
              {copy(
                "Timing, cancellation and retained records",
                "المدة والإلغاء والبيانات المحتفظ بها",
              )}
            </h2>
            <p>
              {copy(
                "AYIN currently provides a 14-day grace period from the request. You can cancel a requested deletion from Account while it is in Requested or Grace period status. After grace, the account is deactivated and its sessions and mobile notification associations stop. An additional 24-hour technical recovery window precedes irreversible identity anonymization and creator-content withdrawal.",
                "يمنح AYIN حاليًا فترة سماح 14 يومًا من الطلب. يمكنك إلغاء الحذف من الحساب ما دامت الحالة طلبًا جديدًا أو في فترة السماح. بعد ذلك يُعطّل الحساب وتتوقف جلساته وارتباطات إشعارات الموبايل، ثم توجد نافذة استرداد تقنية إضافية 24 ساعة قبل إزالة الهوية غير القابلة للعكس وسحب محتوى المنشئ من النشر.",
              )}
            </p>
            <p>
              {copy(
                "Profile and account identifiers are anonymized, disposable activity is removed, and owned media is queued for asynchronous storage cleanup. Completion can take additional time while cleanup is processed. Financial, fraud/security, moderation and audit records may be retained where needed for accounting, disputes, safety or legal obligations; identifying fields are anonymized where appropriate. Backups and legally preserved records are not promised to disappear immediately.",
                "تُزال هوية بيانات الحساب والملفات الشخصية، وتُحذف الأنشطة القابلة للإزالة، وتُدرج الوسائط المملوكة في معالجة حذف التخزين غير المتزامنة؛ وقد يستغرق اكتمالها وقتًا إضافيًا. قد تُحتفظ بسجلات مالية وأمنية وإشرافية وسجلات تدقيق للمحاسبة والنزاعات والسلامة والالتزامات القانونية، مع إزالة الهوية حيثما يناسب. لا نعد بمحو النسخ الاحتياطية أو السجلات المحفوظة قانونيًا فورًا.",
              )}
            </p>
          </section>
          <section className={styles.section}>
            <h2>{copy("Cannot access your account?", "لا تستطيع الوصول إلى الحساب؟")}</h2>
            <p>
              {copy(
                "Use password recovery, or email the existing AYIN privacy contact to request account and associated data deletion. Identify the account using its registered email address; ownership verification is required. Never send your password, one-time codes, signing keys or identity documents in an ordinary email.",
                "استخدم استعادة كلمة المرور، أو راسل جهة اتصال خصوصية AYIN لطلب حذف الحساب والبيانات المرتبطة. حدد الحساب ببريده المسجل؛ يلزم التحقق من الملكية. لا ترسل كلمة المرور أو الرموز المؤقتة أو مفاتيح التوقيع أو مستندات الهوية في بريد عادي.",
              )}
            </p>
            <p>
              <Link href={href("/forgot-password")}>
                {copy("Recover account access", "استعادة الوصول للحساب")}
              </Link>
              {" · "}
              <a href="mailto:mohamed@horusmedia.net?subject=AYIN%20account%20deletion">
                mohamed@horusmedia.net
              </a>
            </p>
          </section>
        </>
      ) : (
        <>
          <section className={styles.section}>
            <h2>{copy("Contact AYIN", "التواصل مع AYIN")}</h2>
            <p>
              {copy(
                "For account access, privacy, safety concerns or app problems, contact the AYIN address below. Include the affected public video or channel link and a short description. Do not include passwords or one-time login codes.",
                "للوصول للحساب أو الخصوصية أو مخاوف السلامة أو مشاكل التطبيق، تواصل مع عنوان AYIN التالي، وأرفق رابط الفيديو أو القناة العامة ووصفًا مختصرًا. لا تُرفق كلمات المرور أو رموز الدخول المؤقتة.",
              )}
            </p>
            <p>
              <a href="mailto:mohamed@horusmedia.net?subject=AYIN%20support">
                mohamed@horusmedia.net
              </a>
            </p>
            <p>
              <Link href={href("/studio/support")}>
                {copy("Open support tickets when signed in", "فتح تذاكر الدعم بعد تسجيل الدخول")}
              </Link>
            </p>
          </section>
          <section className={styles.section}>
            <h2>{copy("Report content and block abuse", "الإبلاغ عن المحتوى وحظر الإساءة")}</h2>
            <p>
              {copy(
                "Use Report on the affected video, channel or comment, or report a community post from its own controls. Choose the reason and describe the concern without reposting harmful material. Blocking an abusive account is separate from reporting: use Block user on a channel or comment author, and manage blocked accounts from Account.",
                "استخدم الإبلاغ بجانب الفيديو أو القناة أو التعليق المعني، أو أبلغ عن منشور المجتمع من أدواته. اختر السبب واشرح المشكلة دون إعادة نشر مادة ضارة. الحظر منفصل عن الإبلاغ: استخدم حظر المستخدم على القناة أو بجانب صاحب التعليق، وأدِر الحسابات المحظورة من صفحة الحساب.",
              )}
            </p>
            <p>
              {copy(
                "Our team reviews reports; sending a report does not guarantee a particular moderation decision or immediate removal. For copyright requests, use the copyright instructions.",
                "يراجع الفريق البلاغات؛ إرسال بلاغ لا يضمن قرارًا معينًا أو إزالة فورية. لطلبات حقوق النشر، اتبع تعليمات حقوق النشر.",
              )}
            </p>
            <p>
              <Link href={href("/community-guidelines")}>
                {copy("Community guidelines", "إرشادات المجتمع")}
              </Link>
              {" · "}
              <Link href={href("/copyright")}>
                {copy("Copyright requests", "طلبات حقوق النشر")}
              </Link>
            </p>
          </section>
        </>
      )}
      <nav className={styles.notice} aria-label={copy("Privacy and help", "الخصوصية والمساعدة")}>
        <Link href={href("/privacy")}>{copy("Privacy policy", "سياسة الخصوصية")}</Link>
        {" · "}
        <Link href={href(deletion ? "/support" : "/account-deletion")}>
          {deletion ? copy("Support", "الدعم") : copy("Delete account", "حذف الحساب")}
        </Link>
      </nav>
    </main>
  );
}
