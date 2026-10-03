"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  SelectField,
  StatusNotice,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import {
  readUploadHistory,
  uploadHistoryStatuses,
  type UploadHistorySnapshot,
  type UploadHistoryStatus,
} from "@/lib/upload-history";
import styles from "./upload-history.module.css";

export function UploadHistory() {
  const { locale, href } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [snapshot, setSnapshot] = useState<UploadHistorySnapshot | null>(null);
  const [status, setStatus] = useState<UploadHistoryStatus | "">("");
  const [applied, setApplied] = useState<UploadHistoryStatus | "">("");
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const hide = () => {
      operation.current?.abort();
      setSnapshot(null);
      setBusy(false);
    };
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      operation.current?.abort();
    };
  }, []);
  async function read(page: number, filter = status) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFailed(false);
    setSnapshot(null);
    try {
      const result = await readUploadHistory(page, filter, controller.signal);
      if (!controller.signal.aborted) {
        setSnapshot(result);
        setApplied(filter);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const labels: Record<string, string> = {
    UPLOADING: copy("Uploading", "جارٍ الرفع"),
    VALIDATING: copy("Validating", "جارٍ التحقق"),
    DRAFT: copy("Draft", "مسودة"),
    PUBLISHED: copy("Published", "منشور"),
    SCHEDULED: copy("Scheduled", "مجدول"),
    PUBLIC: copy("Public", "عام"),
    UNLISTED: copy("Unlisted", "غير مدرج"),
    PRIVATE: copy("Private", "خاص"),
    LONG_FORM: copy("Video", "فيديو"),
    CLIP: copy("Clip", "مقطع"),
    INGESTING: copy("Ingesting", "جارٍ الاستلام"),
    QUEUED: copy("Queued", "في قائمة الانتظار"),
    PROCESSING: copy("Processing", "جارٍ المعالجة"),
    VERIFYING: copy("Verifying", "جارٍ التحقق"),
    READY: copy("Ready", "جاهز"),
    FAILED: copy("Failed", "فشل"),
    CANCELLED: copy("Cancelled", "ملغى"),
  };
  const format = (v: number) => new Intl.NumberFormat(locale).format(v);
  return (
    <section
      className={styles.history}
      aria-label={copy("Saved upload history", "سجل الرفع المحفوظ")}
    >
      <PageHeader
        level={2}
        title={copy("Saved upload history", "سجل الرفع المحفوظ")}
        description={copy(
          "Review saved source uploads and processing before starting another upload. This read does not resume or publish a file.",
          "راجع ملفات الرفع المحفوظة ومعالجتها قبل بدء رفع آخر. هذه القراءة لا تستأنف ملفًا ولا تنشره.",
        )}
      />
      <Disclosure summary={copy("Review saved uploads", "مراجعة ملفات الرفع المحفوظة")}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void read(1);
          }}
          className={styles.filters}
        >
          <SelectField
            id="upload-history-status"
            label={copy("Video status", "حالة الفيديو")}
            value={status}
            disabled={busy}
            onChange={(event) => setStatus(event.target.value as UploadHistoryStatus | "")}
          >
            <option value="">{copy("All statuses", "كل الحالات")}</option>
            {uploadHistoryStatuses.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </SelectField>
          <ActionButton type="submit" pending={busy}>
            {copy("Read saved uploads", "قراءة ملفات الرفع المحفوظة")}
          </ActionButton>
        </form>
        {failed ? (
          <StatusNotice
            announce="assertive"
            tone="warning"
            title={copy("Upload history unavailable", "سجل الرفع غير متاح")}
          >
            {copy(
              "Read again to verify your current account and records.",
              "اقرأ مجددًا للتحقق من حسابك الحالي وسجلاته.",
            )}
          </StatusNotice>
        ) : null}
        {snapshot ? (
          <>
            <p>
              {copy(
                "Records reflect this explicit read. Open Studio to edit a saved video's details.",
                "تعكس السجلات هذه القراءة الصريحة. افتح الاستوديو لتعديل تفاصيل فيديو محفوظ.",
              )}
            </p>
            <ActionLink href={href("/studio/content")}>
              {copy("Open Studio content", "فتح محتوى الاستوديو")}
            </ActionLink>
            {!snapshot.items.length ? (
              <p>
                {copy(
                  "No saved source uploads match this page and filter.",
                  "لا توجد ملفات رفع مصدرية محفوظة تطابق هذه الصفحة والتصفية.",
                )}
              </p>
            ) : (
              <div className={styles.records}>
                {snapshot.items.map((row) => (
                  <article key={row.id} className={styles.record}>
                    <h3 dir="auto">{row.title}</h3>
                    <p>
                      <DataBadge>{labels[row.status]}</DataBadge> · {labels[row.visibility]} ·{" "}
                      {labels[row.videoForm]}
                    </p>
                    <p>
                      {copy("Created", "أُنشئ")}:{" "}
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(row.createdAt))}
                    </p>
                    <p>
                      <bdi>{row.id}</bdi>
                    </p>
                    {row.processing ? (
                      <p>
                        {copy("Latest processing generation", "آخر جيل معالجة")}:{" "}
                        {format(row.processing.generation)} · {labels[row.processing.status]} ·{" "}
                        {format(row.processing.progressPercent)}%
                        {row.processing.errorCode ? (
                          <>
                            {" "}
                            · <bdi>{row.processing.errorCode}</bdi>
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p>{copy("No processing job returned", "لم تُرجع مهمة معالجة")}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
            <PageControls
              label={copy("Upload history pages", "صفحات سجل الرفع")}
              summary={copy(
                `Page ${format(snapshot.pagination.page)} of ${format(snapshot.pagination.pages)} · ${format(snapshot.pagination.total)} uploads`,
                `صفحة ${format(snapshot.pagination.page)} من ${format(snapshot.pagination.pages)} · ${format(snapshot.pagination.total)} ملف رفع`,
              )}
              previousLabel={copy("Previous", "السابق")}
              nextLabel={copy("Next", "التالي")}
              hasPrevious={!busy && snapshot.pagination.page > 1}
              hasNext={
                !busy && snapshot.pagination.page < Math.min(1000, snapshot.pagination.pages)
              }
              onPrevious={() => void read(snapshot.pagination.page - 1, applied)}
              onNext={() => void read(snapshot.pagination.page + 1, applied)}
            />
            {snapshot.pagination.pages > 1000 ? (
              <p>
                {copy(
                  "This view reaches 25,000 records. Filter by status for older history.",
                  "يعرض هذا المسار حتى ٢٥٬٠٠٠ سجل. صفِّ حسب الحالة لمراجعة سجل أقدم.",
                )}
              </p>
            ) : null}
          </>
        ) : null}
      </Disclosure>
    </section>
  );
}
