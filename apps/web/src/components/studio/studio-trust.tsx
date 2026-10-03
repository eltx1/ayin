"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  FormSection,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
} from "@/components/ui/design-system";
import {
  appealInput,
  CreatorTrustRequestError,
  getCreatorTrust,
  submitCreatorAppeal,
  type CreatorTrustSnapshot,
} from "@/lib/creator-trust";
import styles from "./studio-trust.module.css";
const kinds = {
  WARN: ["Warning", "تنبيه"],
  STRIKE: ["Strike", "مخالفة"],
  SUSPEND_ACCOUNT: ["Account suspension", "تعليق الحساب"],
  SUSPEND_CHANNEL: ["Channel suspension", "تعليق القناة"],
  UNPUBLISH_VIDEO: ["Video unpublished", "إلغاء نشر الفيديو"],
  REMOVE_VIDEO: ["Video removed", "إزالة الفيديو"],
} as const;
const statuses = {
  OPEN: ["Open", "مفتوح"],
  REVIEWING: ["Under review", "قيد المراجعة"],
  UPHELD: ["Upheld", "تم تأييد الإجراء"],
  OVERTURNED: ["Overturned", "تم إلغاء الإجراء"],
} as const;
function PageSection<T>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: readonly T[];
  render: (row: T) => ReactNode;
}) {
  const { locale, formatNumber } = useI18n(),
    [page, setPage] = useState(1),
    current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20))),
    start = (current - 1) * 20;
  return (
    <section className={styles.panel} aria-label={title}>
      <h2>{title}</h2>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.slice(start, start + 20).map((row, index) => (
            <li key={start + index}>{render(row)}</li>
          ))}
        </ul>
      ) : (
        <p>
          {locale === "ar"
            ? "لا توجد سجلات متاحة في هذه القراءة."
            : "No records available in this snapshot."}
        </p>
      )}
      {rows.length > 20 && (
        <PageControls
          label={title}
          summary={`${formatNumber(start + 1)}–${formatNumber(Math.min(start + 20, rows.length))} / ${formatNumber(rows.length)}`}
          previousLabel={locale === "ar" ? "السابق" : "Previous"}
          nextLabel={locale === "ar" ? "التالي" : "Next"}
          hasPrevious={current > 1}
          hasNext={start + 20 < rows.length}
          onPrevious={() => setPage(current - 1)}
          onNext={() => setPage(current + 1)}
        />
      )}
    </section>
  );
}
export function StudioTrust() {
  const { locale, href, formatDate, formatNumber } = useI18n(),
    text = (en: string, ar: string) => (locale === "ar" ? ar : en),
    label = <T extends readonly [string, string]>(copy: T) => copy[locale === "ar" ? 1 : 0],
    date = (value: string) =>
      `${formatDate(value, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const [data, setData] = useState<CreatorTrustSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false),
    [actionId, setActionId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [outcome, setOutcome] = useState<"sent" | "invalid" | null>(null);
  const read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null),
    mounted = useRef(false),
    owner = useRef<string | null>(null),
    uncertainty = useRef(false);
  const [knownSentAction, setKnownSentAction] = useState<string | null>(null);
  const readSnapshot = useCallback(() => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return getCreatorTrust(controller.signal)
      .then((next) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (owner.current !== next.accountId) {
          setActionId("");
          setMessage("");
          setOutcome(null);
          uncertainty.current = false;
          setUncertain(false);
        }
        owner.current = next.accountId;
        setData(next);
        setReviewed(true);
      })
      .catch((caught: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (caught instanceof CreatorTrustRequestError && [401, 403].includes(caught.status)) {
          setDenied(true);
          setActionId("");
          setMessage("");
          setOutcome(null);
          owner.current = null;
        }
        setError(true);
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) {
          read.current = null;
          setLoading(false);
        }
      });
  }, [setMessage]);
  const refresh = useCallback(() => {
    if (write.current) return;
    setData(null);
    setLoading(true);
    setError(false);
    setDenied(false);
    setReviewed(false);
    void readSnapshot();
  }, [readSnapshot]);
  useEffect(() => {
    mounted.current = true;
    void readSnapshot();
    const hide = () => {
      read.current?.abort();
      if (write.current) {
        uncertainty.current = true;
        setUncertain(true);
        write.current.abort();
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        write.current = null;
        setBusy(false);
        refresh();
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      read.current?.abort();
      write.current?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [readSnapshot, refresh]);
  useEffect(() => {
    const dirty = () => Boolean(message.trim() || write.current || uncertainty.current);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === "_blank" ||
        target.hasAttribute("download") ||
        target.href === location.href
      )
        return;
      if (
        !window.confirm(
          locale === "ar"
            ? "مغادرة الصفحة؟ ستفقد مسودة الاستئناف المحلية."
            : "Leave this page? Your local appeal draft will be lost.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [message, locale]);
  const inProgress =
    knownSentAction === actionId ||
    Boolean(
      data?.appeals.some(
        (row) => row.actionId === actionId && ["OPEN", "REVIEWING"].includes(row.status),
      ),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      write.current ||
      read.current ||
      uncertainty.current ||
      !data ||
      error ||
      inProgress ||
      !data.actions.some((row) => row.id === actionId)
    )
      return;
    let input: ReturnType<typeof appealInput>;
    try {
      input = appealInput(actionId, message);
    } catch {
      setOutcome("invalid");
      return;
    }
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setOutcome(null);
    setReviewed(false);
    try {
      await submitCreatorAppeal(data.accountId, input, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setMessage("");
      setActionId("");
      setKnownSentAction(input.actionId);
      setOutcome("sent");
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      if (caught instanceof CreatorTrustRequestError && [401, 403].includes(caught.status)) {
        setData(null);
        setDenied(true);
        setActionId("");
        setMessage("");
        owner.current = null;
      }
      uncertainty.current = true;
      setUncertain(true);
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        write.current = null;
        setBusy(false);
      }
    }
  }
  const blocked = busy || loading || uncertain || error || denied || !data;
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={text("Trust & Safety", "الثقة والسلامة")}
        description={text(
          "Review moderation notices, channel trust and your appeals.",
          "راجع إشعارات الإشراف وحالة الثقة لقنواتك واستئنافاتك.",
        )}
        actions={
          <ActionButton tone="secondary" disabled={busy || loading} onClick={refresh}>
            {text("Refresh history", "تحديث السجل")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {text("Loading trust history…", "جارٍ تحميل سجل الثقة…")}
        </StatusNotice>
      )}
      {(error || denied) && (
        <StatusNotice tone="danger" announce="assertive">
          {text(
            "Trust history could not be loaded. Retry reading without repeating a submitted appeal.",
            "تعذر تحميل سجل الثقة. أعد القراءة دون تكرار استئناف مُرسل.",
          )}{" "}
          <ActionButton disabled={busy || loading} onClick={refresh}>
            {text("Retry reading", "إعادة القراءة")}
          </ActionButton>
          {denied && (
            <ActionLink href={href("/login")}>{text("Sign in", "تسجيل الدخول")}</ActionLink>
          )}
        </StatusNotice>
      )}
      {outcome && (
        <StatusNotice tone={outcome === "sent" ? "success" : "danger"} announce="polite">
          {outcome === "sent"
            ? text(
                "Appeal sent. Refresh history to view its status.",
                "تم إرسال الاستئناف. حدّث السجل لعرض حالته.",
              )
            : text(
                "Select an action and enter an explanation of 20–5000 characters.",
                "اختر إجراءً وأدخل شرحًا من ٢٠ إلى ٥٠٠٠ حرف.",
              )}
        </StatusNotice>
      )}
      {uncertain && (
        <StatusNotice tone="warning" announce="assertive">
          <p>
            {text(
              "The appeal may already have been received. It was not repeated. Refresh and review appeal history before deciding what to do next.",
              "ربما استُلم الاستئناف بالفعل. لم يتكرر الطلب. حدّث سجل الاستئنافات وراجعه قبل اختيار الخطوة التالية.",
            )}
          </p>
          <ActionButton disabled={busy || loading} onClick={refresh}>
            {text("Review appeal history", "مراجعة سجل الاستئنافات")}
          </ActionButton>{" "}
          <ActionButton
            disabled={!reviewed || !data || busy || loading}
            onClick={() => {
              uncertainty.current = false;
              setUncertain(false);
            }}
          >
            {text("I have reviewed the result", "راجعت نتيجة العملية")}
          </ActionButton>
        </StatusNotice>
      )}
      <form className={styles.panel} onSubmit={(event) => void submit(event)}>
        <FormSection
          id="creator-appeal"
          legend={text("Submit an appeal", "إرسال استئناف")}
          disabled={blocked}
        >
          <SelectField
            id="appeal-action"
            label={text("Moderation action", "إجراء الإشراف")}
            value={actionId}
            required
            onChange={(event) => setActionId(event.target.value)}
          >
            <option value="">{text("Select an action", "اختر إجراءً")}</option>
            {data?.actions.map((row) => (
              <option key={row.id} value={row.id}>
                {label(kinds[row.kind])} · {date(row.createdAt)} · {row.reason.slice(0, 120)}
              </option>
            ))}
          </SelectField>
          <TextAreaField
            id="appeal-message"
            label={text("Appeal explanation", "شرح الاستئناف")}
            minLength={20}
            maxLength={5000}
            required
            rows={6}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <ActionButton type="submit" disabled={inProgress || !actionId}>
            {text("Send appeal", "إرسال الاستئناف")}
          </ActionButton>
          {inProgress && (
            <p>
              {knownSentAction === actionId
                ? text(
                    "An appeal for this action was sent during this visit. Refresh history to follow its status.",
                    "أُرسل استئناف لهذا الإجراء خلال هذه الزيارة. حدّث السجل لمتابعة حالته.",
                  )
                : text(
                    "This action already has an open appeal in the current history. Review its status below.",
                    "لهذا الإجراء استئناف مفتوح في السجل الحالي. راجع حالته أدناه.",
                  )}
            </p>
          )}
        </FormSection>
      </form>
      {data && (
        <>
          <StatusNotice>
            {text(
              "Actions, appeals and notices show the latest 100 records in each category. This is a bounded snapshot, not a complete lifetime history.",
              "تعرض الإجراءات والاستئنافات والإشعارات أحدث ١٠٠ سجل في كل فئة. هذه قراءة محدودة وليست السجل الكامل مدى الحياة.",
            )}
          </StatusNotice>
          <PageSection
            title={text("Channel trust", "ثقة القنوات")}
            rows={data.trust}
            render={(row) => (
              <Disclosure
                summary={
                  <>
                    <strong dir="auto">
                      {row.channelId === data.channel.id
                        ? data.channel.name
                        : text("Channel", "قناة")}
                    </strong>{" "}
                    ·{" "}
                    <DataBadge>
                      {text(
                        {
                          NEW: "New",
                          STANDARD: "Standard",
                          TRUSTED: "Trusted",
                          RESTRICTED: "Restricted",
                        }[row.level],
                        { NEW: "جديدة", STANDARD: "عادية", TRUSTED: "موثوقة", RESTRICTED: "مقيدة" }[
                          row.level
                        ],
                      )}
                    </DataBadge>
                  </>
                }
              >
                <p>
                  {text("Strikes", "المخالفات")}: {formatNumber(row.strikeCount)}
                </p>
                <p>
                  {row.reviewRequired
                    ? text("Review required", "المراجعة مطلوبة")
                    : text("Review not required", "المراجعة غير مطلوبة")}
                </p>
                <p>{date(row.updatedAt)}</p>
                <p>
                  {text("Channel reference", "مرجع القناة")}: <span dir="ltr">{row.channelId}</span>
                </p>
              </Disclosure>
            )}
          />
          <PageSection
            title={text("Moderation actions", "إجراءات الإشراف")}
            rows={data.actions}
            render={(row) => (
              <Disclosure
                summary={
                  <>
                    {label(kinds[row.kind])} · {date(row.createdAt)}
                  </>
                }
              >
                <p dir="auto">{row.reason}</p>
              </Disclosure>
            )}
          />
          <PageSection
            title={text("Appeal history", "سجل الاستئنافات")}
            rows={data.appeals}
            render={(row) => (
              <Disclosure
                summary={
                  <>
                    {label(kinds[row.action.kind])} ·{" "}
                    <DataBadge>{label(statuses[row.status])}</DataBadge> · {date(row.updatedAt)}
                  </>
                }
              >
                <p dir="auto">{row.message}</p>
                {row.resolution && (
                  <>
                    <strong>{text("Resolution", "القرار")}</strong>
                    <p dir="auto">{row.resolution}</p>
                  </>
                )}
                <p dir="auto">{row.action.reason}</p>
              </Disclosure>
            )}
          />
          <PageSection
            title={text("Moderation notices", "إشعارات الإشراف")}
            rows={data.notices}
            render={(row) => (
              <Disclosure
                summary={
                  <>
                    <strong dir="auto">{row.title}</strong> · {date(row.createdAt)}
                  </>
                }
              >
                <p dir="auto">{row.body}</p>
                <p>{row.readAt ? text("Read", "مقروء") : text("Unread", "غير مقروء")}</p>
              </Disclosure>
            )}
          />
        </>
      )}
    </div>
  );
}
