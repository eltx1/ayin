"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, ActionLink, PageHeader, StatusNotice } from "@/components/ui/design-system";
import { Disclosure } from "@/components/ui/data-presentation";
import { UploadRecoveryClient, type RecoveryView } from "@/lib/upload-recovery";
import { RECOVERY_STORAGE_KEY } from "@/lib/upload-recovery-storage";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import styles from "./upload-history.module.css";
import recoveryStyles from "./upload-recovery.module.css";

export function UploadRecovery() {
  const { locale, href } = useI18n();
  const { identity, identityRevision, isIdentityCurrent, onBeforeIdentitySuspend } =
    useViewerProduct();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [view, setView] = useState<RecoveryView | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const client = useRef<UploadRecoveryClient | null>(null);
  const facts = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let active = true;
    let instance: UploadRecoveryClient;
    try {
      instance = new UploadRecoveryClient({
        storage: window.localStorage,
        changed: (next) => {
          if (!next.scope && facts.current) facts.current.hidden = true;
          if (active) setView(next);
        },
      });
      client.current = instance;
      setInitialized(true);
    } catch {
      setStorageAvailable(false);
      return;
    }
    const hide = () => {
      if (facts.current) facts.current.hidden = true;
      instance.suspend();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === RECOVERY_STORAGE_KEY || event.key === null) hide();
    };
    const unsubscribe = onBeforeIdentitySuspend(hide);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storageChanged);
    return () => {
      active = false;
      unsubscribe();
      instance.suspend();
      client.current = null;
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storageChanged);
    };
  }, [onBeforeIdentitySuspend]);
  useLayoutEffect(() => {
    if (facts.current) facts.current.hidden = true;
    const verified =
      identity &&
      isIdentityCurrent() &&
      identity.account?.id &&
      identity.profile?.id &&
      identity.channel?.id;
    client.current?.suspend(
      verified && identity
        ? {
            accountId: identity.account.id,
            profileId: identity.profile.id,
            channelId: identity.channel.id,
          }
        : undefined,
    );
  }, [identity, identityRevision, isIdentityCurrent]);
  const session = view?.saved?.session;
  const expired = session ? Date.parse(session.expiresAt) <= Date.now() : false;
  const mutable = Boolean(
    session && !expired && ["OPEN", "PREPARING"].includes(session.state) && !view?.saved?.pending,
  );
  const observation = view?.inspection?.observation;
  const readyToFinish = Boolean(
    session?.state === "OPEN" &&
    (observation?.kind === "STORED_UNVERIFIED" ||
      (observation?.kind === "PARTS_OBSERVED" && observation.parts.length === session.partCount)),
  );
  const messages: Record<string, string> = {
    UPLOADING: copy("Uploading your video…", "جارٍ رفع الفيديو…"),
    READY_COMPLETE: copy(
      "Your upload is ready to finish. AYIN will then check and prepare your video.",
      "الرفع جاهز للإنهاء. سيتحقق AYIN بعد ذلك من الفيديو ويجهزه.",
    ),
    INITIAL: copy(
      "Read availability and the saved upload on this device when you are ready.",
      "اقرأ الإتاحة وبيانات الرفع المحفوظة على هذا الجهاز عندما تكون جاهزًا.",
    ),
    WORKING: copy("Checking this upload…", "جارٍ التحقق من الرفع…"),
    AUTHORITY_UNVERIFIED: copy(
      "Your current account could not be verified. Upload details are hidden; check again when your connection is ready.",
      "تعذر التحقق من حسابك الحالي. أُخفيت بيانات الرفع؛ تحقق مجددًا عندما يصبح الاتصال جاهزًا.",
    ),
    VIDEO_TOO_LARGE: copy(
      "This file exceeds the current upload size limit.",
      "يتجاوز هذا الملف الحد الحالي لحجم الرفع.",
    ),
    UPLOAD_PART_LIMIT: copy(
      "This file exceeds the supported upload capacity.",
      "يتجاوز هذا الملف سعة الرفع المدعومة.",
    ),
    UPLOAD_RATE_LIMITED: copy(
      "Too many upload requests. Wait briefly, then try the action again.",
      "طلبات الرفع كثيرة. انتظر قليلًا ثم أعد المحاولة.",
    ),
    CHANNEL_UPLOAD_QUOTA_REACHED: copy(
      "Your channel has reached its storage quota. Review its uploads in Studio.",
      "وصلت قناتك إلى حصة التخزين. راجع ملفات الرفع في الاستوديو.",
    ),
    UPLOAD_ADMISSION_LIMIT: copy(
      "Resolve an existing upload or pending cleanup before creating another.",
      "أكمل معالجة رفع موجود أو تنظيف معلق قبل إنشاء رفع آخر.",
    ),
    UPLOAD_RECOVERY_UNSUPPORTED: copy(
      "Upload recovery is not available yet. You can use the standard upload above.",
      "استئناف الرفع غير متاح بعد. يمكنك استخدام الرفع المعتاد أعلاه.",
    ),
    CHOOSE_FILE: copy(
      "Choose a video to prepare a recoverable upload.",
      "اختر فيديو لإعداد رفع قابل للاستئناف.",
    ),
    SAVED: copy(
      "A saved upload was found. Inspect its current status, then select the original file to continue.",
      "تم العثور على رفع محفوظ. افحص حالته الحالية ثم اختر الملف الأصلي للمتابعة.",
    ),
    HASHING: copy("Checking your video…", "جارٍ التحقق من الفيديو…"),
    FILE_CHECKED: copy(
      "File checked. Continue upload will verify that it matches the original.",
      "تم فحص الملف. تتحقق متابعة الرفع من مطابقته للملف الأصلي.",
    ),
    CREATE_READY: copy(
      "File checked. Create a saved draft when you are ready.",
      "تم فحص الملف. أنشئ مسودة محفوظة عندما تكون جاهزًا.",
    ),
    INSPECT_BEFORE_UPLOAD: copy(
      "Draft saved. Continue the upload when you are ready.",
      "حُفظت المسودة. تابع الرفع عندما تكون جاهزًا.",
    ),
    INSPECTED: copy(
      "Current upload status checked. Reselect and verify the original file after reopening this page.",
      "تم فحص الحالة الحالية. أعد اختيار الملف الأصلي والتحقق منه بعد إعادة فتح الصفحة.",
    ),
    RESUMED: copy("Original file verified.", "تم التحقق من الملف الأصلي."),
    PART_SENT_INSPECT: copy(
      "Part sent. Inspect the upload before the next action.",
      "أُرسل الجزء. افحص الرفع قبل الإجراء التالي.",
    ),
    STORED_UNVERIFIED: copy(
      "Your upload still needs checking and processing before it can be published.",
      "لا يزال الرفع بحاجة إلى التحقق والمعالجة قبل نشر الفيديو.",
    ),
    COMPLETED: copy(
      "Upload accepted. AYIN is checking and preparing your video. Follow its progress in Studio before publishing.",
      "تم قبول الرفع. يتحقق AYIN من الفيديو ويجهزه. تابع تقدمه في الاستوديو قبل النشر.",
    ),
    CANCELLED_PENDING: copy(
      "Upload canceled. Cleanup is pending.",
      "أُلغي الرفع. التنظيف قيد الانتظار.",
    ),
    UPLOAD_FILE_CHANGED: copy(
      "This is not the original file. Select the exact original file and inspect again.",
      "هذا ليس الملف الأصلي. اختر الملف الأصلي المطابق وافحص الرفع مجددًا.",
    ),
    AUTHORITY_CHANGED: copy(
      "Your account or access changed. Saved details were cleared from this device. Sign in with the original account and check Studio.",
      "تغير حسابك أو صلاحياتك. مُسحت البيانات المحفوظة من هذا الجهاز. سجّل الدخول بالحساب الأصلي وراجع الاستوديو.",
    ),
    EXPIRED: copy(
      "This saved upload has expired. Cancel it to request cleanup.",
      "انتهت صلاحية هذا الرفع المحفوظ. ألغِه لطلب التنظيف.",
    ),
    UNRESOLVED: copy(
      "This upload cannot continue yet. Check its status, or cancel it.",
      "لا يمكن متابعة الرفع بعد. تحقق من حالته أو ألغِه.",
    ),
    STOPPED: copy(
      "Stopped on this device. Some data may have arrived; check the saved upload before continuing.",
      "توقف الرفع على هذا الجهاز. قد تكون بعض البيانات وصلت؛ تحقق من الرفع المحفوظ قبل المتابعة.",
    ),
    INVALID_FILE: copy(
      "Choose one non-empty supported video file.",
      "اختر ملف فيديو واحدًا غير فارغ بصيغة مدعومة.",
    ),
  };
  const uncertain = copy(
    "We could not confirm the last step. Check your saved upload before continuing.",
    "تعذر تأكيد الخطوة الأخيرة. تحقق من الرفع المحفوظ قبل المتابعة.",
  );
  return (
    <section
      className={styles.history}
      aria-label={copy("Recoverable uploads", "الرفع القابل للاستئناف")}
    >
      <PageHeader
        level={2}
        title={copy("Recoverable uploads", "الرفع القابل للاستئناف")}
        description={copy(
          "Keep the original file on your device. Reopening this page requires selecting it again; only safe session details are saved here.",
          "احتفظ بالملف الأصلي على جهازك. ستحتاج لاختياره مجددًا عند فتح الصفحة؛ تُحفظ هنا بيانات الجلسة الآمنة فقط.",
        )}
      />
      <Disclosure summary={copy("Continue a saved upload", "متابعة رفع محفوظ")}>
        <ActionButton
          type="button"
          disabled={
            view?.busy || !storageAvailable || !initialized || !identity || !isIdentityCurrent()
          }
          onClick={() => void client.current?.check()}
        >
          {copy("Check saved upload", "التحقق من الرفع المحفوظ")}
        </ActionButton>
        <StatusNotice announce="polite">
          {storageAvailable
            ? (messages[view?.message ?? "INITIAL"] ?? uncertain)
            : copy(
                "Device storage is unavailable. Recoverable upload controls cannot start safely here.",
                "تخزين الجهاز غير متاح. لا يمكن بدء الرفع القابل للاستئناف بأمان هنا.",
              )}
        </StatusNotice>
        {view?.scope ? (
          <div
            ref={facts}
            data-private-viewer-identity
            key={`${view.scope.accountId}:${view.scope.profileId}:${view.scope.channelId}`}
            className={`${styles.records} ${recoveryStyles.facts}`}
          >
            {!view.supported && view.message !== "UPLOAD_RECOVERY_UNSUPPORTED" ? (
              <p>{messages.UPLOAD_RECOVERY_UNSUPPORTED}</p>
            ) : null}
            {(view.supported || view.saved) &&
            !["COMPLETED", "ABORTED", "REVOKED"].includes(session?.state ?? "") ? (
              <label className={`${styles.record} ${recoveryStyles.picker}`}>
                <span>{copy("Choose original video", "اختيار الفيديو الأصلي")}</span>
                <input
                  type="file"
                  accept=".mp4,.mov,.mkv,.webm,.avi,.mpeg,.mpg,.mts,.m2ts,.ts,.3gp,.3g2,.m4v,.wmv,.flv,.ogv,.mxf"
                  disabled={view.busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void client.current?.choose(file);
                  }}
                />
                {view.fileName ? <span dir="auto">{view.fileName}</span> : null}
              </label>
            ) : null}
            {view.message === "HASHING" ? (
              <progress
                max={100}
                value={view.progress}
                aria-label={copy("File check progress", "تقدم فحص الملف")}
              />
            ) : null}
            {!view.saved ? (
              <ActionButton
                type="button"
                disabled={!view.supported || !view.fileName || view.busy}
                onClick={() => void client.current?.create()}
              >
                {copy("Save draft", "حفظ المسودة")}
              </ActionButton>
            ) : (
              <>
                {session ? (
                  <article className={styles.record}>
                    <h3>{copy("Saved upload", "الرفع المحفوظ")}</h3>
                    {!["COMPLETED", "ABORTED", "REVOKED"].includes(session.state) ? (
                      <>
                        <progress
                          max={100}
                          value={view.uploadProgress}
                          aria-label={copy("Upload progress", "تقدم الرفع")}
                        />
                        <p>{view.uploadProgress}%</p>
                      </>
                    ) : null}
                    {expired ? <p>{messages.EXPIRED}</p> : null}
                    <div className={styles.filters}>
                      <ActionButton
                        type="button"
                        disabled={
                          view.busy ||
                          !mutable ||
                          !view.supported ||
                          !view.fileName ||
                          (readyToFinish && view.fileMatched)
                        }
                        onClick={() => void client.current?.continueUpload()}
                      >
                        {copy("Continue upload", "متابعة الرفع")}
                      </ActionButton>
                      <ActionButton
                        type="button"
                        disabled={
                          view.busy ||
                          !mutable ||
                          !view.supported ||
                          !view.fileMatched ||
                          !readyToFinish
                        }
                        onClick={() => void client.current?.complete()}
                      >
                        {copy("Finish upload", "إنهاء الرفع")}
                      </ActionButton>
                      <ActionButton
                        type="button"
                        tone="danger"
                        disabled={
                          view.busy || ["COMPLETED", "ABORTED", "REVOKED"].includes(session.state)
                        }
                        onClick={() => void client.current?.cancel()}
                      >
                        {copy("Cancel upload", "إلغاء الرفع")}
                      </ActionButton>
                    </div>
                    <Disclosure summary={copy("Upload details", "تفاصيل الرفع")}>
                      <p>
                        {copy("Expires", "تنتهي في")}:{" "}
                        {new Date(session.expiresAt).toLocaleString(locale)}
                      </p>
                      <p>
                        {copy("Parts received", "الأجزاء المستلمة")}:{" "}
                        {view.inspection?.observation.kind === "PARTS_OBSERVED"
                          ? view.inspection.observation.parts.length
                          : view.inspection?.observation.kind === "STORED_UNVERIFIED"
                            ? session.partCount
                            : "—"}{" "}
                        / {session.partCount}
                      </p>
                      <p>
                        {copy(
                          "After an interrupted request, a status check does not resend it. Choose Continue upload to start a new attempt once its outcome is known.",
                          "بعد انقطاع الطلب، لا يُعاد إرساله عند فحص الحالة. اختر متابعة الرفع لبدء محاولة جديدة بعد معرفة نتيجته.",
                        )}
                      </p>
                      {["ABORTED", "REVOKED", "CANCELLING"].includes(session.state) ? (
                        <p>
                          {copy(
                            "Older upload links may still work. Cleanup stays pending until the storage provider confirms all writes have settled.",
                            "قد تظل روابط الرفع القديمة صالحة. يظل التنظيف معلقًا حتى يؤكد مزود التخزين انتهاء جميع عمليات الكتابة.",
                          )}
                        </p>
                      ) : null}
                    </Disclosure>
                  </article>
                ) : null}
              </>
            )}
            {["COMPLETED", "CANCELLED_PENDING"].includes(view.message) ? (
              <>
                <p>
                  {copy(
                    "Removing these device details does not delete the video or settle storage cleanup.",
                    "إزالة بيانات الجهاز هذه لا تحذف الفيديو ولا تنهي تنظيف التخزين.",
                  )}
                </p>
                <ActionButton
                  type="button"
                  disabled={view.busy}
                  onClick={() => client.current?.forgetFinished()}
                >
                  {copy("Remove finished device details", "إزالة بيانات الجلسة المنتهية من الجهاز")}
                </ActionButton>
              </>
            ) : null}
            <ActionLink href={href("/studio/content")}>
              {copy("Review in Studio", "المراجعة في الاستوديو")}
            </ActionLink>
          </div>
        ) : null}
        {view?.busy ? (
          <ActionButton type="button" tone="secondary" onClick={() => client.current?.stop()}>
            {copy("Stop", "إيقاف")}
          </ActionButton>
        ) : null}
      </Disclosure>
    </section>
  );
}
