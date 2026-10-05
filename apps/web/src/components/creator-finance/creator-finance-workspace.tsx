"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  PageHeader,
  MetricList,
  StatusNotice,
  TextField,
  TextAreaField,
  FormSection,
  DataBadge,
} from "@/components/ui/design-system";
import {
  Disclosure,
  DataTable,
  PageControls,
  type TableColumn,
} from "@/components/ui/data-presentation";
import { EditorTabs } from "@/components/ui/editor-tabs";
import {
  CreatorFinanceError,
  exactFinanceMoney,
  financeProfileInput,
  getCreatorFinance,
  getFinanceStatement,
  saveCreatorFinance,
  type FinanceAck,
  type FinanceSnapshot,
  type FinanceWrite,
} from "@/lib/creator-finance";
import type { RevenueDispute } from "@/lib/revenue";
import styles from "./creator-finance-workspace.module.css";

type Draft = {
  legalName: string;
  currency: string;
  provider: string;
  country: string;
  destination: string;
};
const emptyDraft: Draft = {
  legalName: "",
  currency: "USD",
  provider: "MANUAL",
  country: "",
  destination: "",
};
const FinancePages = createContext<{
  pages: Record<string, number>;
  setPages: Dispatch<SetStateAction<Record<string, number>>>;
} | null>(null);
function FinanceRows<Row>({
  caption,
  rows,
  columns,
  rowKey,
}: {
  caption: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
}) {
  const { locale, formatNumber } = useI18n(),
    ar = locale === "ar",
    pagination = useContext(FinancePages),
    page = pagination?.pages[caption] ?? 1,
    last = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, last);
  return (
    <section className={styles.section}>
      <DataTable
        caption={caption}
        rows={rows.slice((current - 1) * 20, current * 20)}
        columns={columns}
        rowKey={rowKey}
      />
      {!rows.length && <p>{ar ? "لا توجد صفوف في هذه القراءة." : "No rows in this snapshot."}</p>}
      <PageControls
        label={caption}
        summary={`${ar ? "الصفحة" : "Page"} ${formatNumber(current)} / ${formatNumber(last)} · ${formatNumber(rows.length)} ${ar ? "صفًا مسترجعًا" : "returned rows"}`}
        previousLabel={ar ? "السابق" : "Previous"}
        nextLabel={ar ? "التالي" : "Next"}
        hasPrevious={current > 1}
        hasNext={current < last}
        onPrevious={() => pagination?.setPages((pages) => ({ ...pages, [caption]: current - 1 }))}
        onNext={() => pagination?.setPages((pages) => ({ ...pages, [caption]: current + 1 }))}
      />
    </section>
  );
}
export function CreatorFinanceWorkspace({ level = 1 }: { level?: 1 | 2 }) {
  const { locale, direction, href, formatDate, formatNumber } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [snapshot, setSnapshot] = useState<FinanceSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [readError, setReadError] = useState(false),
    [authError, setAuthError] = useState(false),
    [ack, setAck] = useState<FinanceAck | null>(null),
    [notice, setNotice] = useState<
      "saved" | "uncertain" | "reviewed" | "invalid" | "statement" | null
    >(null),
    [tab, setTab] = useState("overview"),
    [draft, setDraft] = useState<Draft>(emptyDraft),
    [profileDirty, setProfileDirty] = useState(false),
    [category, setCategory] = useState<RevenueDispute["category"]>("EARNINGS"),
    [payoutId, setPayoutId] = useState(""),
    [message, setMessage] = useState(""),
    [statementAt, setStatementAt] = useState<string | null>(null);
  const [knownAwaitingReview, setKnownAwaitingReview] = useState(false);
  const privateBody = useRef<HTMLDivElement | null>(null);
  const [privateGeneration, setPrivateGeneration] = useState(0);
  const current = useRef<FinanceSnapshot | null>(null),
    read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null),
    operation = useRef(false),
    decisionLocked = useRef(false),
    hydrated = useRef(false),
    dirty = useRef(false);
  const clearIdentity = useCallback(() => {
    if (privateBody.current) privateBody.current.hidden = true;
    privateBody.current?.querySelectorAll("form").forEach((form) => form.reset());
    privateBody.current
      ?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      )
      .forEach((field) => {
        if (field instanceof HTMLSelectElement) field.selectedIndex = -1;
        else {
          field.value = "";
          field.defaultValue = "";
          if (field instanceof HTMLInputElement) field.removeAttribute("value");
        }
      });
    current.current = null;
    hydrated.current = false;
    setSnapshot(null);
    setAck(null);
    setDraft(emptyDraft);
    setProfileDirty(false);
    setMessage("");
    setPayoutId("");
    setStatementAt(null);
    setPages({});
    setAuthError(true);
    setNotice(null);
    setKnownAwaitingReview(false);
    decisionLocked.current = true;
    setLocked(true);
    setReviewed(false);
  }, []);
  const load = useCallback(async () => {
    if (operation.current) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setReadError(false);
    setAuthError(false);
    setSnapshot(null);
    setReviewed(false);
    try {
      const result = await getCreatorFinance(controller.signal, current.current ?? undefined);
      if (controller.signal.aborted) return;
      if (privateBody.current?.hidden) setPrivateGeneration((value) => value + 1);
      current.current = result;
      setKnownAwaitingReview(false);
      setSnapshot(result);
      setReviewed(true);
      if (decisionLocked.current) setNotice("reviewed");
      if (!hydrated.current) {
        hydrated.current = true;
        const p = result.overview.paymentProfile;
        setDraft({
          legalName: p?.legalName ?? "",
          currency: p?.preferredCurrency ?? result.overview.currency,
          provider: p?.provider ?? "MANUAL",
          country: p?.countryCode ?? "",
          destination: "",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof CreatorFinanceError &&
        (error.scopeChanged || [401, 403].includes(error.status))
      )
        clearIdentity();
      else setReadError(true);
    } finally {
      if (read.current === controller) {
        read.current = null;
        setLoading(false);
      }
    }
  }, [clearIdentity]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    const hide = () => {
      const pendingRead = read.current,
        pendingWrite = write.current;
      read.current = null;
      write.current = null;
      operation.current = false;
      pendingRead?.abort();
      pendingWrite?.abort();
      if (privateBody.current) privateBody.current.hidden = true;
      setReadError(true);
      setSnapshot(null);
      setLoading(false);
      setBusy(false);
      decisionLocked.current = true;
      setLocked(true);
      setReviewed(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setSnapshot(null);
        setReadError(true);
        setReviewed(false);
      }
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      const pendingRead = read.current,
        pendingWrite = write.current;
      read.current = null;
      write.current = null;
      pendingRead?.abort();
      pendingWrite?.abort();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", restore);
    };
  }, [load]);
  useEffect(() => {
    dirty.current = profileDirty || Boolean(message) || busy || locked;
  }, [profileDirty, message, busy, locked]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !dirty.current
      )
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!target || target.getAttribute("target") === "_blank" || target.hasAttribute("download"))
        return;
      const raw = target.getAttribute("href");
      if (!raw || raw.startsWith("#")) return;
      if (
        !window.confirm(
          ar
            ? "هناك مسودة أو عملية تحتاج المراجعة. هل تريد المغادرة؟"
            : "A draft or operation still needs review. Leave this page?",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [ar]);
  function edit(field: keyof Draft, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setProfileDirty(true);
    dirty.current = true;
  }
  async function submit(command: FinanceWrite) {
    const observed = current.current;
    if (!observed || operation.current || decisionLocked.current || read.current) return;
    operation.current = true;
    decisionLocked.current = true;
    dirty.current = true;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setLocked(true);
    setReviewed(false);
    setNotice(null);
    try {
      const result = await saveCreatorFinance(observed, command, controller.signal);
      if (controller.signal.aborted) return;
      setAck(result);
      setNotice("saved");
      if (result.kind === "profile") {
        setDraft({
          legalName: result.profile.legalName,
          currency: result.profile.preferredCurrency,
          provider: result.profile.provider,
          country: result.profile.countryCode ?? "",
          destination: "",
        });
        setProfileDirty(false);
      }
      if (result.kind === "dispute") {
        setMessage("");
        setPayoutId("");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof CreatorFinanceError &&
        (error.scopeChanged || [401, 403].includes(error.status))
      ) {
        clearIdentity();
      } else if (error instanceof CreatorFinanceError && error.acknowledged) {
        if (privateBody.current) privateBody.current.hidden = true;
        setSnapshot(null);
        setAck(null);
        setReviewed(false);
        setReadError(true);
        setNotice("saved");
        setKnownAwaitingReview(true);
        if (command.kind === "profile") {
          setDraft((value) => ({ ...value, destination: "" }));
          setProfileDirty(false);
        }
        if (command.kind === "dispute") {
          setMessage("");
          setPayoutId("");
        }
      } else if (error instanceof CreatorFinanceError && !error.writeStarted) {
        if ([401, 403].includes(error.status)) clearIdentity();
        else {
          decisionLocked.current = false;
          setLocked(false);
          setNotice("invalid");
        }
      } else setNotice("uncertain");
    } finally {
      if (write.current === controller) {
        write.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function statement() {
    const observed = current.current;
    if (!observed || operation.current || read.current) return;
    operation.current = true;
    const controller = new AbortController();
    read.current = controller;
    setBusy(true);
    setStatementAt(null);
    try {
      const result = await getFinanceStatement(observed, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([result.content], { type: "text/csv;charset=utf-8" }),
      );
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setStatementAt(result.generatedAt);
      setNotice("statement");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof CreatorFinanceError &&
        (error.scopeChanged || [401, 403].includes(error.status))
      )
        clearIdentity();
      else setReadError(true);
    } finally {
      if (read.current === controller) {
        read.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  const overview = snapshot?.overview,
    analytics = snapshot?.analytics,
    disabled = busy || loading || locked || !snapshot;
  const money = (code: string, value: string | null): ReactNode =>
    value === null ? copy("Unavailable", "غير متاح") : <bdi>{exactFinanceMoney(code, value)}</bdi>;
  const utc = (value: string | null) =>
    value === null
      ? copy("Unavailable", "غير متاح")
      : formatDate(value, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const status = (value: string) =>
    ({
      NOT_STARTED: copy("Not started", "لم يبدأ"),
      PENDING: copy("Pending", "قيد الانتظار"),
      VERIFIED: copy("Verified", "تم التحقق"),
      REQUIRES_ACTION: copy("Action required", "إجراء مطلوب"),
      REJECTED: copy("Rejected", "مرفوض"),
      OPEN: copy("Open", "مفتوح"),
      REVIEWING: copy("Reviewing", "قيد المراجعة"),
      RESOLVED: copy("Resolved", "تم الحل"),
      PROCESSING: copy("Processing", "قيد المعالجة"),
      PAID: copy("Paid", "تم الدفع"),
      FAILED: copy("Failed", "فشل"),
      CANCELLED: copy("Cancelled", "ملغى"),
    })[value] ?? value;
  const eligibilityAction = (action: string) =>
    !ar
      ? action
      : ({
          "Complete your payout details.": "أكمل بيانات الدفع.",
          "Choose an available payout method.": "اختر طريقة دفع متاحة.",
          "Reach the minimum payout amount.": "بلغ الحد الأدنى للسحب.",
          "Wait for your current payout request to finish.": "انتظر اكتمال طلب الدفع الحالي.",
          "Identity check could not be verified. Review the requested action.":
            "تعذر التحقق من الهوية. راجع الإجراء المطلوب.",
          "Complete the requested identity check action.": "أكمل الإجراء المطلوب للتحقق من الهوية.",
          "Identity check is still being reviewed.": "ما زال التحقق من الهوية قيد المراجعة.",
          "Complete identity verification before payout.": "أكمل التحقق من الهوية قبل الدفع.",
          "Tax information could not be accepted. Review the requested action.":
            "تعذر قبول البيانات الضريبية. راجع الإجراء المطلوب.",
          "Complete the requested tax information action.":
            "أكمل الإجراء المطلوب للبيانات الضريبية.",
          "Tax information is still being reviewed.": "ما زالت البيانات الضريبية قيد المراجعة.",
          "Complete the required tax information before payout.":
            "أكمل البيانات الضريبية المطلوبة قبل الدفع.",
          "Payout destination could not be verified.": "تعذر التحقق من وجهة الدفع.",
          "Review your payout destination details.": "راجع بيانات وجهة الدفع.",
          "Payout destination verification is still pending.":
            "ما زال التحقق من وجهة الدفع قيد الانتظار.",
          "Set up and verify a payout destination.": "أعدّ وجهة دفع وتحقق منها.",
        }[action] ?? action);
  return (
    <FinancePages.Provider value={{ pages, setPages }}>
      <section className={styles.workspace}>
        <PageHeader
          level={level}
          title={copy("Earnings & payouts", "الأرباح والمدفوعات")}
          description={copy(
            "Review your channel earnings, payout details, compliance and disputes.",
            "راجع أرباح قناتك وبيانات السحب والامتثال والنزاعات.",
          )}
          actions={
            <ActionButton tone="secondary" disabled={busy || loading} onClick={() => void load()}>
              {copy("Review current state", "مراجعة الحالة الحالية")}
            </ActionButton>
          }
        />
        {authError && (
          <StatusNotice tone="danger" announce="assertive">
            {copy(
              "The account or channel changed. Reopen this workspace after signing in.",
              "تغيّر الحساب أو القناة. افتح مساحة العمل مجددًا بعد تسجيل الدخول.",
            )}{" "}
            <Link href={href("/login")}>{copy("Sign in", "تسجيل الدخول")}</Link>
          </StatusNotice>
        )}
        {knownAwaitingReview && (
          <StatusNotice tone="warning" announce="assertive">
            {copy(
              "The server acknowledged this operation, but the current account could not be verified. Review current state; this command will not be replayed.",
              "أكد الخادم هذه العملية، لكن تعذّر التحقق من الحساب الحالي. راجع الحالة الحالية؛ لن يُعاد إرسال الطلب.",
            )}
          </StatusNotice>
        )}
        <div
          ref={privateBody}
          key={privateGeneration}
          className={styles.privateBody}
          data-private-finance-body="creator"
        >
          {loading && (
            <StatusNotice announce="polite">
              {copy("Loading current earnings…", "جارٍ تحميل الأرباح الحالية…")}
            </StatusNotice>
          )}
          {readError && (
            <StatusNotice tone="danger" announce="assertive">
              {copy(
                "The current state could not be verified. Review it again before another decision.",
                "تعذر التحقق من الحالة الحالية. أعد المراجعة قبل قرار آخر.",
              )}
            </StatusNotice>
          )}
          {notice && (
            <StatusNotice
              announce="polite"
              tone={notice === "uncertain" || notice === "invalid" ? "warning" : "success"}
            >
              {notice === "saved"
                ? copy(
                    "The server acknowledged this operation. Review current state before another write.",
                    "أكد الخادم هذه العملية. راجع الحالة الحالية قبل كتابة أخرى.",
                  )
                : notice === "uncertain"
                  ? copy(
                      "The response was not confirmed. Your draft is retained. Review the actual profile, payouts or disputes before deciding; this request will not be replayed.",
                      "لم يتأكد الرد. احتفظنا بمسودتك. راجع البيانات أو المدفوعات أو النزاعات الفعلية قبل اتخاذ قرار؛ لن يُعاد إرسال الطلب تلقائيًا.",
                    )
                  : notice === "invalid"
                    ? copy(
                        "Check the entered values. No write was started.",
                        "راجع البيانات المُدخلة. لم تبدأ عملية الكتابة.",
                      )
                    : notice === "reviewed"
                      ? copy(
                          "Current state reviewed. Compare it with your retained draft and acknowledgment, then explicitly enable another operation.",
                          "تمت مراجعة الحالة الحالية. قارنها بالمسودة وتأكيد الحفظ، ثم فعّل العملية التالية بنفسك.",
                        )
                      : copy(
                          "The verified CSV statement was downloaded.",
                          "تم تنزيل كشف CSV الذي جرى التحقق منه.",
                        )}
            </StatusNotice>
          )}
          {ack && (
            <Disclosure open summary={copy("Acknowledged operation", "العملية التي أكدها الخادم")}>
              <dl className={styles.facts}>
                {ack.kind === "profile" ? (
                  <>
                    <dt>{copy("Saved legal name", "الاسم القانوني المحفوظ")}</dt>
                    <dd dir="auto">{ack.profile.legalName}</dd>
                    <dt>{copy("Saved currency / provider", "العملة / المزوّد المحفوظ")}</dt>
                    <dd>
                      <bdi>
                        {ack.profile.preferredCurrency} / {ack.profile.provider}
                      </bdi>
                    </dd>
                    <dt>{copy("Saved destination mask", "الوجهة المحفوظة المقنّعة")}</dt>
                    <dd>
                      <bdi>{ack.profile.destinationMask ?? copy("Unavailable", "غير متاح")}</bdi>
                    </dd>
                  </>
                ) : ack.kind === "payout" ? (
                  <>
                    <dt>{copy("Payout reference", "مرجع الدفع")}</dt>
                    <dd>
                      <bdi>{ack.id}</bdi>
                    </dd>
                    <dt>{copy("Acknowledged amount / status", "المبلغ / الحالة المؤكدة")}</dt>
                    <dd>
                      {money(ack.currency, ack.amount)} · {status(ack.status)}
                    </dd>
                  </>
                ) : ack.kind === "dispute" ? (
                  <>
                    <dt>{copy("Dispute reference", "مرجع النزاع")}</dt>
                    <dd>
                      <bdi>{ack.dispute.id}</bdi>
                    </dd>
                    <dt>{copy("Acknowledged message", "الرسالة المؤكدة")}</dt>
                    <dd className={styles.prose} dir="auto">
                      {ack.dispute.message}
                    </dd>
                  </>
                ) : ack.kind === "start" ? (
                  <>
                    <dt>{copy("Compliance step", "خطوة الامتثال")}</dt>
                    <dd>
                      {ack.step === "IDENTITY"
                        ? copy("Identity", "الهوية")
                        : copy("Tax", "الضرائب")}{" "}
                      · {status(ack.status)}
                    </dd>
                    {ack.actionUrl && (
                      <dd>
                        <a href={ack.actionUrl} target="_blank" rel="noopener noreferrer">
                          {copy(
                            "Continue with the configured provider",
                            "المتابعة مع المزوّد المُعدّ",
                          )}
                        </a>
                      </dd>
                    )}
                  </>
                ) : (
                  <>
                    <dt>{copy("Compliance eligibility", "أهلية الامتثال")}</dt>
                    <dd>
                      {ack.compliance.payoutComplianceEligible
                        ? copy("Eligible", "مؤهل")
                        : copy("Requirements remain", "توجد متطلبات متبقية")}
                    </dd>
                  </>
                )}
              </dl>
            </Disclosure>
          )}
          {locked && (
            <StatusNotice tone="warning">
              <p>
                {copy(
                  "Writes stay locked until you review current state and acknowledge the next decision. Unsaved fields remain separate from saved records.",
                  "تظل الكتابة مقفلة حتى تراجع الحالة الحالية وتقرّ بقرارك التالي. تبقى الحقول غير المحفوظة منفصلة عن السجلات المحفوظة.",
                )}
              </p>
              <ActionButton
                tone="secondary"
                disabled={!reviewed || !snapshot || busy || loading}
                onClick={() => {
                  decisionLocked.current = false;
                  setLocked(false);
                  setNotice(null);
                }}
              >
                {copy(
                  "I reviewed the state; enable the next operation",
                  "راجعت الحالة؛ فعّل العملية التالية",
                )}
              </ActionButton>
            </StatusNotice>
          )}
          {overview && analytics && (
            <>
              <MetricList
                label={copy("Current earnings", "الأرباح الحالية")}
                items={[
                  {
                    label: copy("Estimated earnings", "الأرباح التقديرية"),
                    value: money(overview.currency, overview.estimatedRevenue),
                  },
                  {
                    label: copy("Finalized earnings", "الأرباح النهائية"),
                    value: money(overview.currency, overview.finalizedRevenue),
                  },
                  {
                    label: copy("Available to withdraw", "المتاح للسحب"),
                    value: money(overview.currency, overview.availableForPayout),
                  },
                  {
                    label: copy("On hold for payouts", "محجوز للمدفوعات"),
                    value: money(overview.currency, overview.onHoldForPayout),
                  },
                ]}
              />
              <EditorTabs
                label={copy("Monetization sections", "أقسام تحقيق الربح")}
                direction={direction}
                value={tab}
                onChange={setTab}
                tabs={[
                  {
                    id: "overview",
                    label: copy("Overview", "نظرة عامة"),
                    content: (
                      <div className={styles.report}>
                        <MetricList
                          label={copy("Contract and threshold", "العقد والحد الأدنى")}
                          items={[
                            {
                              label: copy("Revenue share", "نسبة الأرباح"),
                              value: `${formatNumber(overview.contract.revenueShareBps / 100, { maximumFractionDigits: 2 })}%`,
                            },
                            {
                              label: copy("Contract source", "مصدر العقد"),
                              value:
                                overview.contract.source === "CHANNEL_OVERRIDE"
                                  ? copy("Channel contract", "عقد القناة")
                                  : copy("Platform default", "الإعداد الافتراضي"),
                            },
                            {
                              label: copy("Payout minimum", "الحد الأدنى للسحب"),
                              value: money(overview.currency, overview.payoutThreshold),
                            },
                            {
                              label: copy("Threshold progress", "التقدم إلى الحد الأدنى"),
                              value: `${formatNumber(overview.payoutProgressPercent, { maximumFractionDigits: 2 })}%`,
                            },
                          ]}
                        />
                        <p>
                          {overview.channel.name} · <bdi>@{overview.channel.handle}</bdi>
                        </p>
                        <p>
                          {copy(
                            "These tables expose every row returned by the current API. Ledger and payout summaries are bounded snapshots; use the CSV statement for the exported history. All displayed timestamps use UTC.",
                            "تعرض الجداول كل صف يعيده الطلب الحالي. ملخصا السجل والمدفوعات محدودان؛ استخدم كشف CSV للتاريخ المُصدّر. كل الأوقات المعروضة بتوقيت UTC.",
                          )}
                        </p>
                        <FinanceRows
                          caption={copy("Revenue by video", "الأرباح حسب الفيديو")}
                          rows={overview.byVideo}
                          rowKey={(r) => r.videoId}
                          columns={[
                            {
                              key: "title",
                              heading: copy("Video", "الفيديو"),
                              rowHeader: true,
                              render: (r) => <span dir="auto">{r.title}</span>,
                            },
                            {
                              key: "estimated",
                              heading: copy("Estimated", "تقديري"),
                              render: (r) => money(overview.currency, r.estimated),
                            },
                            {
                              key: "finalized",
                              heading: copy("Finalized", "نهائي"),
                              render: (r) => money(overview.currency, r.finalized),
                            },
                          ]}
                        />
                        <FinanceRows
                          caption={copy("Revenue by period", "الأرباح حسب الفترة")}
                          rows={overview.byPeriod}
                          rowKey={(r) => r.period}
                          columns={[
                            {
                              key: "period",
                              heading: copy("Period", "الفترة"),
                              rowHeader: true,
                              render: (r) => <bdi>{r.period}</bdi>,
                            },
                            {
                              key: "estimated",
                              heading: copy("Estimated", "تقديري"),
                              render: (r) => money(overview.currency, r.estimated),
                            },
                            {
                              key: "finalized",
                              heading: copy("Finalized", "نهائي"),
                              render: (r) => money(overview.currency, r.finalized),
                            },
                          ]}
                        />
                        <Disclosure
                          summary={copy("Recent ledger records", "سجلات دفتر الأرباح الأخيرة")}
                        >
                          <FinanceRows
                            caption={copy("Recent ledger", "دفتر الأرباح الأخير")}
                            rows={overview.recentLedger}
                            rowKey={(r) => r.id}
                            columns={[
                              {
                                key: "date",
                                heading: copy("Time · UTC", "الوقت · UTC"),
                                rowHeader: true,
                                render: (r) => utc(r.occurredAt),
                              },
                              {
                                key: "amount",
                                heading: copy("Amount", "المبلغ"),
                                render: (r) => money(r.currency, r.amount),
                              },
                              {
                                key: "state",
                                heading: copy("State / type", "الحالة / النوع"),
                                render: (r) => (
                                  <bdi>
                                    {r.state} / {r.type}
                                  </bdi>
                                ),
                              },
                              {
                                key: "memo",
                                heading: copy("Memo / video", "الوصف / الفيديو"),
                                render: (r) => (
                                  <span dir="auto">
                                    {r.memo ?? "—"} {r.video?.title}
                                  </span>
                                ),
                              },
                            ]}
                          />
                        </Disclosure>
                      </div>
                    ),
                  },
                  {
                    id: "payment",
                    label: copy("Payment details", "بيانات الدفع"),
                    content: (
                      <div className={styles.report}>
                        <h3>{copy("Payment details", "بيانات الدفع")}</h3>
                        <Disclosure
                          summary={copy(
                            "Currently saved payment details",
                            "بيانات الدفع المحفوظة حاليًا",
                          )}
                        >
                          <dl className={styles.facts}>
                            <dt>{copy("Legal name", "الاسم القانوني")}</dt>
                            <dd dir="auto">
                              {overview.paymentProfile?.legalName ??
                                copy("Not configured", "غير مُعدّ")}
                            </dd>
                            <dt>{copy("Currency / provider", "العملة / المزوّد")}</dt>
                            <dd>
                              <bdi>
                                {overview.paymentProfile?.preferredCurrency ?? overview.currency} /{" "}
                                {overview.paymentProfile?.provider ??
                                  overview.providerConnection.activeProvider}
                              </bdi>
                            </dd>
                            <dt>{copy("Destination mask", "الوجهة المقنّعة")}</dt>
                            <dd>
                              <bdi>
                                {overview.paymentProfile?.destinationMask ??
                                  copy("Not configured", "غير مُعدّ")}
                              </bdi>
                            </dd>
                            <dt>{copy("Last saved · UTC", "آخر حفظ · UTC")}</dt>
                            <dd>{utc(overview.paymentProfile?.updatedAt ?? null)}</dd>
                          </dl>
                        </Disclosure>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            try {
                              void submit({
                                kind: "profile",
                                input: financeProfileInput({
                                  legalName: draft.legalName,
                                  preferredCurrency: draft.currency,
                                  provider: draft.provider,
                                  countryCode: draft.country.trim() || null,
                                  ...(draft.destination.trim()
                                    ? { destination: draft.destination }
                                    : {}),
                                }),
                              });
                            } catch {
                              setNotice("invalid");
                            }
                          }}
                        >
                          <FormSection
                            id="creator-finance-profile"
                            legend={copy("Edit payment details", "تعديل بيانات الدفع")}
                            disabled={disabled}
                            description={copy(
                              "Leave destination blank to retain the saved destination. Availability comes from the configured AYIN provider; payment brand names do not imply a connected service.",
                              "اترك الوجهة فارغة للاحتفاظ بالوجهة المحفوظة. الإتاحة تتبع المزوّد المُعدّ في AYIN؛ أسماء وسائل الدفع لا تعني اتصال خدمة.",
                            )}
                          >
                            <TextField
                              id="finance-legal-name"
                              label={copy("Legal name", "الاسم القانوني")}
                              value={draft.legalName}
                              minLength={2}
                              maxLength={160}
                              required
                              autoComplete="name"
                              onChange={(e) => edit("legalName", e.target.value)}
                            />
                            <TextField
                              id="finance-currency"
                              label={copy(
                                "Preferred currency · ISO code",
                                "العملة المفضلة · رمز ISO",
                              )}
                              value={draft.currency}
                              pattern="[A-Za-z]{3}"
                              minLength={3}
                              maxLength={3}
                              required
                              dir="ltr"
                              onChange={(e) => edit("currency", e.target.value)}
                            />
                            <label htmlFor="finance-provider">
                              {copy("Payout provider", "مزوّد المدفوعات")}
                            </label>
                            <select
                              id="finance-provider"
                              value={draft.provider}
                              onChange={(e) => edit("provider", e.target.value)}
                            >
                              {[
                                ...new Set([
                                  draft.provider,
                                  overview.paymentProfile?.provider ?? "MANUAL",
                                  ...(overview.providerConnection.manualPayoutEnabled
                                    ? ["MANUAL"]
                                    : []),
                                  ...(overview.providerConnection.externalProvidersConnected
                                    ? [overview.providerConnection.externalProvider.provider]
                                    : []),
                                ]),
                              ].map((provider) => (
                                <option key={provider} value={provider}>
                                  {provider}
                                </option>
                              ))}
                            </select>
                            <TextField
                              id="finance-country"
                              label={copy("Country · optional ISO code", "البلد · رمز ISO اختياري")}
                              value={draft.country}
                              pattern="[A-Za-z]{2}"
                              maxLength={2}
                              dir="ltr"
                              onChange={(e) => edit("country", e.target.value)}
                            />
                            <TextAreaField
                              id="finance-destination"
                              label={copy(
                                "New payout destination · optional",
                                "وجهة دفع جديدة · اختيارية",
                              )}
                              hint={copy(
                                "Retained only in this page until a matching save is acknowledged. External providers may require their own tokenized destination workflow.",
                                "تظل في هذه الصفحة حتى يتأكد حفظ مطابق. قد يطلب المزوّد الخارجي إعداد الوجهة عبر مساره الخاص.",
                              )}
                              value={draft.destination}
                              required={
                                draft.provider === "MANUAL" &&
                                !(
                                  overview.paymentProfile?.provider === "MANUAL" &&
                                  overview.paymentProfile.hasDestination
                                )
                              }
                              minLength={4}
                              maxLength={1500}
                              autoComplete="off"
                              onChange={(e) => edit("destination", e.target.value)}
                            />
                            <ActionButton type="submit">
                              {copy("Save payment details", "حفظ بيانات الدفع")}
                            </ActionButton>
                          </FormSection>
                        </form>
                        <section>
                          <h3>{copy("Compliance", "الامتثال")}</h3>
                          <dl className={styles.facts}>
                            <dt>{copy("Identity", "الهوية")}</dt>
                            <dd>
                              {overview.compliance.identity.required
                                ? status(overview.compliance.identity.status)
                                : copy(
                                    "Not required by current configuration",
                                    "غير مطلوب وفق الإعداد الحالي",
                                  )}
                            </dd>
                            <dt>{copy("Tax", "الضرائب")}</dt>
                            <dd>
                              {overview.compliance.tax.required
                                ? status(overview.compliance.tax.status)
                                : copy(
                                    "Not required by current configuration",
                                    "غير مطلوب وفق الإعداد الحالي",
                                  )}
                            </dd>
                            <dt>{copy("Destination verification", "التحقق من الوجهة")}</dt>
                            <dd>
                              {overview.compliance.payoutDestination.required
                                ? status(overview.compliance.payoutDestination.status)
                                : copy(
                                    "Not required by current configuration",
                                    "غير مطلوب وفق الإعداد الحالي",
                                  )}
                            </dd>
                            <dt>{copy("Provider connection", "اتصال المزوّد")}</dt>
                            <dd>
                              {overview.compliance.provider.connected
                                ? copy("Connected", "متصل")
                                : copy("Unavailable", "غير متاح")}
                            </dd>
                          </dl>
                          <div className={styles.actions}>
                            <ActionButton
                              tone="secondary"
                              disabled={disabled || !overview.compliance.identity.actionAvailable}
                              onClick={() => void submit({ kind: "start", step: "IDENTITY" })}
                            >
                              {copy("Start identity verification", "بدء التحقق من الهوية")}
                            </ActionButton>
                            <ActionButton
                              tone="secondary"
                              disabled={disabled || !overview.compliance.tax.actionAvailable}
                              onClick={() => void submit({ kind: "start", step: "TAX" })}
                            >
                              {copy("Start tax verification", "بدء التحقق الضريبي")}
                            </ActionButton>
                            <ActionButton
                              tone="secondary"
                              disabled={
                                disabled ||
                                !overview.compliance.provider.connected ||
                                !overview.compliance.provider.productionEnabled ||
                                !overview.paymentProfile
                              }
                              onClick={() => void submit({ kind: "refresh" })}
                            >
                              {copy("Refresh compliance status", "تحديث حالة الامتثال")}
                            </ActionButton>
                          </div>
                        </section>
                      </div>
                    ),
                  },
                  {
                    id: "payouts",
                    label: copy("Payouts", "المدفوعات"),
                    content: (
                      <div className={styles.report}>
                        <DataBadge tone={overview.canRequestPayout ? "success" : "warning"}>
                          {overview.canRequestPayout
                            ? copy("Eligible to request", "مؤهل لتقديم طلب")
                            : copy("Requirements remain", "توجد متطلبات متبقية")}
                        </DataBadge>
                        {overview.payoutEligibility.actionsRequired.length > 0 && (
                          <ul>
                            {overview.payoutEligibility.actionsRequired.map((action, i) => (
                              <li key={i} dir="auto">
                                {eligibilityAction(action)}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p>
                          {copy(
                            "This request uses the current saved currency and server eligibility. A draft currency change does not change the request. The server checks every requirement again.",
                            "يستخدم الطلب العملة المحفوظة الحالية وأهلية الخادم. تعديل العملة في المسودة لا يغيّر الطلب. يفحص الخادم كل متطلب مجددًا.",
                          )}
                        </p>
                        <ActionButton
                          disabled={disabled || !overview.canRequestPayout}
                          onClick={() => {
                            if (
                              window.confirm(
                                copy(
                                  "Request the currently available payout in the saved currency?",
                                  "هل تريد طلب سحب المتاح بالعملة المحفوظة الحالية؟",
                                ),
                              )
                            )
                              void submit({ kind: "payout" });
                          }}
                        >
                          {copy("Request payout", "طلب سحب الأرباح")}
                        </ActionButton>
                        <FinanceRows
                          caption={copy("Returned payout records", "سجلات المدفوعات المسترجعة")}
                          rows={overview.payouts}
                          rowKey={(r) => r.id}
                          columns={[
                            {
                              key: "id",
                              heading: copy("Reference", "المرجع"),
                              rowHeader: true,
                              render: (r) => <bdi>{r.id}</bdi>,
                            },
                            {
                              key: "status",
                              heading: copy("Status", "الحالة"),
                              render: (r) => status(r.status),
                            },
                            {
                              key: "amount",
                              heading: copy("Amount", "المبلغ"),
                              render: (r) => money(r.currency, r.amount),
                            },
                            {
                              key: "requested",
                              heading: copy("Requested · UTC", "تاريخ الطلب · UTC"),
                              render: (r) => utc(r.requestedAt),
                            },
                            {
                              key: "processed",
                              heading: copy("Processed · UTC", "تاريخ المعالجة · UTC"),
                              render: (r) => utc(r.processedAt),
                            },
                            {
                              key: "paid",
                              heading: copy("Paid · UTC", "تاريخ الدفع · UTC"),
                              render: (r) => utc(r.paidAt),
                            },
                          ]}
                        />
                      </div>
                    ),
                  },
                  {
                    id: "disputes",
                    label: copy("Disputes", "النزاعات"),
                    content: (
                      <div className={styles.report}>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submit({
                              kind: "dispute",
                              input: { category, message, payoutId: payoutId || null },
                            });
                          }}
                        >
                          <FormSection
                            id="finance-dispute"
                            legend={copy("Open a revenue dispute", "فتح نزاع بشأن الأرباح")}
                            disabled={disabled}
                          >
                            <label htmlFor="finance-dispute-category">
                              {copy("Category", "الفئة")}
                            </label>
                            <select
                              id="finance-dispute-category"
                              value={category}
                              onChange={(e) =>
                                setCategory(e.target.value as RevenueDispute["category"])
                              }
                            >
                              <option value="EARNINGS">{copy("Earnings", "الأرباح")}</option>
                              <option value="PAYOUT">{copy("Payout", "الدفع")}</option>
                              <option value="OTHER">{copy("Other", "أخرى")}</option>
                            </select>
                            <label htmlFor="finance-dispute-payout">
                              {copy("Payout reference · optional", "مرجع الدفع · اختياري")}
                            </label>
                            <select
                              id="finance-dispute-payout"
                              value={payoutId}
                              onChange={(e) => setPayoutId(e.target.value)}
                            >
                              <option value="">
                                {copy("No payout reference", "بلا مرجع دفع")}
                              </option>
                              {payoutId && !overview.payouts.some((p) => p.id === payoutId) && (
                                <option value={payoutId}>{payoutId}</option>
                              )}
                              {overview.payouts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.id} · {p.currency} {p.amount}
                                </option>
                              ))}
                            </select>
                            <TextAreaField
                              id="finance-dispute-message"
                              label={copy("Detailed message", "الرسالة التفصيلية")}
                              value={message}
                              required
                              minLength={20}
                              maxLength={5000}
                              onChange={(e) => {
                                setMessage(e.target.value);
                                dirty.current = true;
                              }}
                            />
                            <ActionButton type="submit">
                              {copy("Submit dispute", "إرسال النزاع")}
                            </ActionButton>
                          </FormSection>
                        </form>
                        <p>
                          {copy(
                            "The API returns up to100 recent disputes; every returned item is reachable below. This is not the complete historical archive.",
                            "يعيد الطلب حتى ١٠٠ نزاع حديث؛ يمكنك الوصول إلى كل عنصر مسترجع أدناه. هذه ليست كل السجلات التاريخية.",
                          )}
                        </p>
                        <FinanceRows
                          caption={copy("Current dispute records", "سجلات النزاعات الحالية")}
                          rows={snapshot.disputes}
                          rowKey={(r) => r.id}
                          columns={[
                            {
                              key: "id",
                              heading: copy("Reference", "المرجع"),
                              rowHeader: true,
                              render: (r) => <bdi>{r.id}</bdi>,
                            },
                            {
                              key: "status",
                              heading: copy("Status", "الحالة"),
                              render: (r) => status(r.status),
                            },
                            {
                              key: "message",
                              heading: copy("Message / resolution", "الرسالة / الحل"),
                              render: (r) => (
                                <div className={styles.prose} dir="auto">
                                  {r.message}
                                  {r.resolution && <p>{r.resolution}</p>}
                                </div>
                              ),
                            },
                            {
                              key: "payout",
                              heading: copy("Payout reference", "مرجع الدفع"),
                              render: (r) => <bdi>{r.payoutId ?? "—"}</bdi>,
                            },
                            {
                              key: "date",
                              heading: copy("Created · UTC", "تاريخ الإنشاء · UTC"),
                              render: (r) => utc(r.createdAt),
                            },
                          ]}
                        />
                      </div>
                    ),
                  },
                  {
                    id: "reports",
                    label: copy("Reports", "التقارير"),
                    content: (
                      <div className={styles.report}>
                        <MetricList
                          label={copy("Monetization performance", "أداء تحقيق الربح")}
                          items={[
                            {
                              label: copy("Finalized ·30 days", "النهائي · ٣٠ يومًا"),
                              value: money(analytics.currency, analytics.finalizedRevenue30d),
                            },
                            {
                              label: copy("Creator RPM", "RPM للمنشئ"),
                              value: money(analytics.currency, analytics.creatorRpm),
                            },
                            {
                              label: copy("Creator CPM", "CPM للمنشئ"),
                              value: money(analytics.currency, analytics.creatorCpm),
                            },
                            {
                              label: copy("Video starts ·30 days", "بدء الفيديو · ٣٠ يومًا"),
                              value: formatNumber(analytics.videoStarts),
                            },
                            {
                              label: copy(
                                "Monetized ad starts ·30 days",
                                "بدء إعلانات الربح · ٣٠ يومًا",
                              ),
                              value: formatNumber(analytics.monetizedAdStarts),
                            },
                          ]}
                        />
                        {analytics.mixedCurrency && (
                          <StatusNotice>
                            {copy(
                              "Multiple ledger currencies exist. These metrics use the displayed currency only; no FX conversion is applied.",
                              "توجد عملات متعددة في دفتر الأرباح. تستخدم المقاييس العملة المعروضة فقط؛ لا يوجد تحويل عملات.",
                            )}
                          </StatusNotice>
                        )}
                        <p>
                          {copy(
                            "Daily and ad-source tables use entries received during the last90 days; headline metrics use30 days. Daily rows are grouped by ledger period where available.",
                            "تستخدم جداول الأيام ومصادر الإعلان القيود المستلمة خلال آخر ٩٠ يومًا؛ تستخدم المقاييس الرئيسية ٣٠ يومًا. تُجمّع الأيام وفق فترة القيد عند توفرها.",
                          )}
                        </p>
                        <ActionButton
                          tone="secondary"
                          disabled={busy || loading}
                          onClick={() => void statement()}
                        >
                          {copy("Download CSV statement", "تنزيل كشف CSV")}
                        </ActionButton>
                        {statementAt && (
                          <p>
                            {copy("Statement generated · UTC", "إنشاء الكشف · UTC")}{" "}
                            {utc(statementAt)}
                          </p>
                        )}
                        <FinanceRows
                          caption={copy("Daily revenue", "الأرباح اليومية")}
                          rows={analytics.byDay}
                          rowKey={(r) => r.day}
                          columns={[
                            {
                              key: "day",
                              heading: copy("Date · UTC", "التاريخ · UTC"),
                              rowHeader: true,
                              render: (r) =>
                                formatDate(`${r.day}T00:00:00Z`, {
                                  dateStyle: "medium",
                                  timeZone: "UTC",
                                }),
                            },
                            {
                              key: "estimated",
                              heading: copy("Estimated", "تقديري"),
                              render: (r) => money(analytics.currency, r.estimated),
                            },
                            {
                              key: "finalized",
                              heading: copy("Finalized", "نهائي"),
                              render: (r) => money(analytics.currency, r.finalized),
                            },
                          ]}
                        />
                        <FinanceRows
                          caption={copy("Revenue by ad source", "الأرباح حسب مصدر الإعلان")}
                          rows={analytics.byAdSource}
                          rowKey={(r) => r.source}
                          columns={[
                            {
                              key: "source",
                              heading: copy("Source", "المصدر"),
                              rowHeader: true,
                              render: (r) => <span dir="auto">{r.source}</span>,
                            },
                            {
                              key: "estimated",
                              heading: copy("Estimated", "تقديري"),
                              render: (r) => money(analytics.currency, r.estimated),
                            },
                            {
                              key: "finalized",
                              heading: copy("Finalized", "نهائي"),
                              render: (r) => money(analytics.currency, r.finalized),
                            },
                          ]}
                        />
                        <StatusNotice>
                          <p>
                            {copy(
                              "Country revenue attribution is unavailable: imported ledger entries lack a trusted country dimension.",
                              "توزيع الأرباح حسب البلد غير متاح: لا تحتوي القيود المستوردة على بُعد بلد موثوق.",
                            )}
                          </p>
                          <p>
                            {analytics.estimatedPayoutDate
                              ? utc(analytics.estimatedPayoutDate)
                              : copy(
                                  "Estimated payout date unavailable: no guaranteed processing calendar is configured.",
                                  "موعد الدفع التقديري غير متاح: لا يوجد جدول معالجة مضمون مُعدّ.",
                                )}
                          </p>
                        </StatusNotice>
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
        </div>
      </section>
    </FinancePages.Provider>
  );
}
