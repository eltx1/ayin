"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  FormSection,
  MetricList,
  PageHeader,
  StatusNotice,
  TextAreaField,
} from "@/components/ui/design-system";
import { Disclosure } from "@/components/ui/data-presentation";
import {
  PayoutWorkspaceError,
  readPayoutWorkspace,
  writePayoutWorkspace,
  type PayoutAction,
  type PayoutReveal,
  type PayoutWorkspace,
} from "@/lib/admin-payout-workspace";
import { exactFinanceMoney } from "@/lib/creator-finance";
import styles from "./admin-payout-detail.module.css";

export function AdminPayoutDetail({ payoutId }: { payoutId: string }) {
  const { locale, href } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [snapshot, setSnapshot] = useState<PayoutWorkspace | null>(null);
  const [busy, setBusy] = useState(true),
    [readFailed, setReadFailed] = useState(false);
  const [providerReason, setProviderReason] = useState(""),
    [revealReason, setRevealReason] = useState("");
  const [revealed, setRevealed] = useState<PayoutReveal | null>(null);
  const [notice, setNotice] = useState<"saved" | "unknown" | "verification" | "failed" | null>(
    null,
  );
  const [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [readSequence, setReadSequence] = useState(0);
  const operationKind = useRef<"read" | "write">("read");
  const operation = useRef<AbortController | null>(null),
    locked = useRef(false);
  const facts = useRef<HTMLDivElement | null>(null),
    sensitive = useRef<HTMLPreElement | null>(null);
  const actorId = useRef<string | null>(null);
  function hideSensitive() {
    if (sensitive.current) sensitive.current.textContent = "";
    setRevealed(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = "read";
    void readPayoutWorkspace(payoutId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          actorId.current = next.actor.accountId;
          setSnapshot(next);
          setReadSequence((n) => n + 1);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setReadFailed(true);
      })
      .finally(() => {
        if (operation.current === controller) {
          operation.current = null;
          if (!controller.signal.aborted) setBusy(false);
        }
      });
    const hide = () => {
      if (operation.current && operationKind.current === "write") {
        locked.current = true;
        setUncertain(true);
        setNotice("unknown");
      }
      operation.current?.abort();
      operation.current = null;
      if (sensitive.current) sensitive.current.textContent = "";
      if (facts.current) facts.current.hidden = true;
      setRevealed(null);
      setSnapshot(null);
      setBusy(false);
      setReadFailed(true);
      setReviewed(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      operation.current?.abort();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [payoutId]);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => {
      if (sensitive.current) sensitive.current.textContent = "";
      setRevealed(null);
    }, 60000);
    return () => clearTimeout(timer);
  }, [revealed]);
  useEffect(() => {
    if (!providerReason.trim() && !revealReason.trim() && !uncertain) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(a instanceof HTMLAnchorElement) ||
        a.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        a.href === window.location.href
      )
        return;
      if (
        !window.confirm(
          locale === "ar"
            ? "مغادرة تفاصيل الصرف؟ ستفقد المسودات غير المرسلة. راجع أي نتيجة غير مؤكدة قبل محاولة أخرى."
            : "Leave payout details? Unsent reasons will be lost. Review any uncertain result before another attempt.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [providerReason, revealReason, uncertain, locale]);
  async function read() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = "read";
    setBusy(true);
    setReadFailed(false);
    setReviewed(false);
    setSnapshot(null);
    hideSensitive();
    try {
      const next = await readPayoutWorkspace(payoutId, controller.signal);
      if (controller.signal.aborted) return;
      if (actorId.current && actorId.current !== next.actor.accountId) {
        setProviderReason("");
        setRevealReason("");
      }
      actorId.current = next.actor.accountId;
      setSnapshot(next);
      setReadSequence((n) => n + 1);
      setReviewed(true);
    } catch {
      if (!controller.signal.aborted) setReadFailed(true);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  async function act(action: PayoutAction) {
    if (operation.current || locked.current || !snapshot) return;
    const reason = action === "reveal" ? revealReason : providerReason;
    if (reason.trim().length < 8 || reason.trim().length > 500) return;
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = "write";
    setBusy(true);
    setNotice(null);
    setReviewed(false);
    hideSensitive();
    try {
      const result = await writePayoutWorkspace(action, snapshot, reason, controller.signal);
      if (controller.signal.aborted) throw new PayoutWorkspaceError(0, true);
      setNotice("saved");
      if (result.kind === "reveal") {
        setRevealed(result.value);
        setRevealReason("");
      } else {
        setSnapshot({ ...snapshot, provider: result.value });
        setProviderReason("");
      }
    } catch (error) {
      if (operation.current !== controller) return;
      const e = error instanceof PayoutWorkspaceError ? error : new PayoutWorkspaceError(0, true);
      if (e.verificationRequired) setNotice("verification");
      else if (e.writeStarted) {
        locked.current = true;
        setUncertain(true);
        setNotice("unknown");
      } else setNotice("failed");
      if (e.status === 401 || (e.status === 403 && !e.verificationRequired)) {
        setSnapshot(null);
        setProviderReason("");
        setRevealReason("");
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const detail = snapshot?.detail,
    provider = snapshot?.provider,
    transfer = provider?.transfer;
  const ready = Boolean(
    provider?.capabilities.connected && provider.capabilities.productionEnabled,
  );
  const terminal = Boolean(
    transfer && ["COMPLETED", "FAILED", "CANCELLED"].includes(transfer.state),
  );
  const maySubmit = Boolean(
    detail &&
    detail.provider !== "MANUAL" &&
    ready &&
    provider?.capabilities.idempotentSubmission &&
    provider.capabilities.supportsDestinationTokenization &&
    (detail.status === "PENDING" || transfer?.state === "SUBMISSION_UNKNOWN"),
  );
  const mayRefresh = Boolean(ready && transfer?.externalTransferId && !terminal);
  const mayCancel = Boolean(
    detail &&
    detail.provider !== "MANUAL" &&
    (detail.status === "PENDING" ||
      (ready && provider?.capabilities.supportsCancellation && !terminal)),
  );
  const yes = (v: boolean) => (v ? copy("Yes", "نعم") : copy("No", "لا"));
  const unavailable = copy("Not returned", "لم يرجع");
  const date = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(v)) + " UTC"
      : "—";
  const disabled = busy || uncertain;
  const names: Record<string, string> = {
    PENDING: copy("Pending", "قيد الانتظار"),
    PROCESSING: copy("Processing", "جارٍ التنفيذ"),
    PAID: copy("Paid", "مدفوع"),
    FAILED: copy("Failed", "فشل"),
    CANCELLED: copy("Cancelled", "ملغى"),
    READY: copy("Ready", "جاهز"),
    SUBMITTING: copy("Submitting", "جارٍ الإرسال"),
    SUBMISSION_UNKNOWN: copy("Submission uncertain", "الإرسال غير مؤكد"),
    SUBMITTED: copy("Submitted", "تم الإرسال"),
    CANCEL_REQUESTED: copy("Cancellation requested", "طُلب الإلغاء"),
    COMPLETED: copy("Completed", "مكتمل"),
    UNKNOWN: copy("Unknown", "غير معروف"),
  };
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={copy("Payout detail", "تفاصيل الصرف")}
        description={copy(
          "Review the saved payout and provider transfer separately. A provider submission does not confirm payment.",
          "راجع عملية الصرف المحفوظة وتحويل المزود كلًّا على حدة. إرسال التحويل لا يؤكد الدفع.",
        )}
        actions={
          <>
            <ActionButton tone="secondary" pending={busy} onClick={() => void read()}>
              {copy("Read payout records", "قراءة سجلات الصرف")}
            </ActionButton>
            <ActionLink href={href("/admin/revenue")}>
              {copy("Back to Finance", "العودة إلى المالية")}
            </ActionLink>
          </>
        }
      />
      {notice && (
        <StatusNotice
          announce="polite"
          tone={notice === "saved" ? "success" : "warning"}
          title={
            notice === "saved"
              ? copy("Acknowledged", "تم التأكيد")
              : notice === "verification"
                ? copy("Verify your session", "تحقق من جلستك")
                : notice === "unknown"
                  ? copy("Result uncertain", "النتيجة غير مؤكدة")
                  : copy("Action unavailable", "الإجراء غير متاح")
          }
        >
          {notice === "saved"
            ? copy(
                "The server acknowledged this action. Read the records explicitly when you want their latest state.",
                "أكد الخادم هذا الإجراء. اقرأ السجلات صراحةً عندما تريد أحدث حالتها.",
              )
            : notice === "verification"
              ? copy(
                  "Complete verification, review the retained reason and submit explicitly. Nothing is replayed.",
                  "أكمل التحقق، وراجع السبب المحفوظ ثم أرسل صراحةً. لا يعاد إرسال شيء تلقائيًا.",
                )
              : notice === "unknown"
                ? copy(
                    "Do not assume failure or repeat the action. Read this original payout and provider state, then review before another explicit action.",
                    "لا تفترض الفشل أو تكرر الإجراء. اقرأ عملية الصرف الأصلية وحالة المزود، ثم راجعهما قبل إجراء صريح آخر.",
                  )
                : copy(
                    "The current authority or response could not be verified.",
                    "تعذر التحقق من الصلاحية الحالية أو الرد.",
                  )}
        </StatusNotice>
      )}
      {readFailed && (
        <StatusNotice
          announce="polite"
          tone="warning"
          title={copy("Payout records unavailable", "سجلات الصرف غير متاحة")}
        >
          {copy(
            "Read again to verify current Finance authority and this payout. Earlier private details have been hidden.",
            "اقرأ مجددًا للتحقق من صلاحية المالية الحالية وعملية الصرف هذه. أُخفيت التفاصيل الخاصة السابقة.",
          )}
        </StatusNotice>
      )}
      {uncertain && reviewed && snapshot && (
        <ActionButton
          tone="secondary"
          onClick={() => {
            locked.current = false;
            setUncertain(false);
            setReviewed(false);
          }}
        >
          {copy("I reviewed this payout and provider state", "راجعت عملية الصرف وحالة المزود")}
        </ActionButton>
      )}
      {snapshot && detail && provider && (
        <div
          ref={facts}
          key={`${snapshot.actor.accountId}:${readSequence}`}
          className={styles.records}
        >
          <p>
            {copy(
              "Records reflect the last explicit read; provider acknowledgments are shown separately. Dates use UTC.",
              "تعكس السجلات آخر قراءة صريحة؛ وتظهر تأكيدات المزود بصورة مستقلة. التواريخ بالتوقيت العالمي UTC.",
            )}
          </p>
          <MetricList
            label={copy("Saved payout summary", "ملخص الصرف المحفوظ")}
            items={[
              {
                label: copy("Amount", "المبلغ"),
                value: (
                  <span dir="ltr" className={styles.money}>
                    {exactFinanceMoney(detail.currency, detail.amount)}
                  </span>
                ),
              },
              {
                label: copy("Saved payout status", "حالة الصرف المحفوظة"),
                value: names[detail.status],
              },
              { label: copy("Payout provider", "مزود الصرف"), value: detail.provider },
              {
                label: copy("Channel", "القناة"),
                value: <span dir="auto">@{detail.channel.handle}</span>,
              },
            ]}
          />
          <Disclosure summary={copy("Payout context and beneficiary", "سياق الصرف والمستفيد")} open>
            <dl className={styles.facts}>
              {[
                [copy("Channel name", "اسم القناة"), detail.channel.name],
                [copy("Requested", "طُلب"), date(detail.requestedAt)],
                [copy("Processing", "بدء التنفيذ"), date(detail.processedAt)],
                [copy("Paid", "الدفع"), date(detail.paidAt)],
                [copy("External reference", "المرجع الخارجي"), detail.externalReference ?? "—"],
                [copy("Failure reason", "سبب الفشل"), detail.failureReason ?? "—"],
                [
                  copy("Immutable snapshot available", "لقطة المستفيد الأصلية متاحة"),
                  yes(detail.beneficiarySnapshotAvailable),
                ],
                [
                  copy("Legal name", "الاسم القانوني"),
                  detail.paymentProfile?.legalName ?? unavailable,
                ],
                [
                  copy("Masked destination", "جهة الدفع المحجوبة"),
                  detail.paymentProfile?.destinationMask ?? unavailable,
                ],
                [
                  copy("Country / region", "البلد / المنطقة"),
                  detail.paymentProfile?.countryCode ?? "—",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd dir="auto">{value}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
          <FormSection
            id="payout-provider-action"
            legend={copy("Provider transfer", "تحويل المزود")}
            description={copy(
              "Only an actual confirmed status or verified webhook can confirm provider payment. Submission and payout state are separate.",
              "تأكيد الدفع يعتمد على حالة فعلية مؤكدة أو إشعار مزود موثَّق. الإرسال وحالة الصرف أمران منفصلان.",
            )}
          >
            <DataBadge tone={ready ? "info" : "warning"}>
              {ready
                ? copy("Production enabled", "الإنتاج مُفعّل")
                : copy("Production disabled", "الإنتاج غير مُفعّل")}
            </DataBadge>
            <dl className={styles.facts}>
              {[
                [copy("Configured adapter", "المحول المضبوط"), provider.capabilities.provider],
                [
                  copy("Provider payout status", "حالة الصرف لدى المزود"),
                  names[provider.payout.status],
                ],
                [
                  copy("Transfer state", "حالة التحويل"),
                  transfer ? names[transfer.state] : copy("No transfer created", "لم يُنشأ تحويل"),
                ],
                [
                  copy("External transfer ID", "معرّف التحويل الخارجي"),
                  transfer?.externalTransferId ?? "—",
                ],
                [
                  copy("Provider response state", "حالة رد المزود"),
                  transfer?.providerResponseState ?? "—",
                ],
                [
                  copy("Submission attempts", "محاولات الإرسال"),
                  transfer ? String(transfer.submitAttempts) : unavailable,
                ],
                [
                  copy("Status attempts", "محاولات قراءة الحالة"),
                  transfer ? String(transfer.statusAttempts) : unavailable,
                ],
                [
                  copy("Cancellation attempts", "محاولات الإلغاء"),
                  transfer ? String(transfer.cancelAttempts) : unavailable,
                ],
                [copy("Next retry", "المحاولة التالية"), date(transfer?.nextRetryAt ?? null)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd dir="auto">{value}</dd>
                </div>
              ))}
            </dl>
            <Disclosure
              summary={copy(
                "Actual provider capabilities and retry policy",
                "قدرات المزود وسياسة المحاولة الفعلية",
              )}
            >
              <dl className={styles.facts}>
                {[
                  [copy("Connected", "متصل"), yes(provider.capabilities.connected)],
                  [
                    copy("Idempotent submission", "إرسال يمنع التكرار"),
                    yes(provider.capabilities.idempotentSubmission),
                  ],
                  [
                    copy("Cancellation supported", "يدعم الإلغاء"),
                    yes(provider.capabilities.supportsCancellation),
                  ],
                  [
                    copy("Destination tokenization", "ترميز جهة الدفع"),
                    yes(provider.capabilities.supportsDestinationTokenization),
                  ],
                  [
                    copy("Webhook verification", "توثيق إشعار المزود"),
                    provider.capabilities.webhookVerification,
                  ],
                  [
                    copy("Maximum submission attempts", "أقصى محاولات إرسال"),
                    String(provider.capabilities.retryPolicy.maxSubmissionAttempts),
                  ],
                  [
                    copy("Initial retry delay (seconds)", "تأخير أول محاولة (ثوانٍ)"),
                    String(provider.capabilities.retryPolicy.baseDelaySeconds),
                  ],
                  [
                    copy("Maximum retry delay (seconds)", "أقصى تأخير للمحاولة (ثوانٍ)"),
                    String(provider.capabilities.retryPolicy.maxDelaySeconds),
                  ],
                  [
                    copy("Same key across retries", "المفتاح نفسه في المحاولات"),
                    yes(provider.capabilities.retryPolicy.sameIdempotencyKeyAcrossRetries),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd dir="auto">{value}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
            <TextAreaField
              id="payout-provider-reason"
              label={copy("Provider action reason", "سبب إجراء المزود")}
              hint={copy(
                "8–500 characters. No action is sent automatically.",
                "٨–٥٠٠ حرف. لا يُرسل إجراء تلقائيًا.",
              )}
              value={providerReason}
              maxLength={500}
              disabled={disabled}
              onChange={(e) => setProviderReason(e.target.value)}
            />
            <div className={styles.actions}>
              {(
                [
                  ["submit", maySubmit, copy("Submit / safe retry", "إرسال / محاولة آمنة")],
                  ["status", mayRefresh, copy("Refresh provider status", "تحديث حالة المزود")],
                  ["cancel", mayCancel, copy("Cancel through provider", "إلغاء عبر المزود")],
                ] as const
              ).map(([action, allowed, label]) => (
                <ActionButton
                  key={action}
                  tone={action === "cancel" ? "danger" : "secondary"}
                  disabled={disabled || !allowed || providerReason.trim().length < 8}
                  onClick={() => void act(action)}
                >
                  {label}
                </ActionButton>
              ))}
            </div>
          </FormSection>
          <FormSection
            id="payout-destination-reveal"
            legend={copy("Sensitive destination", "جهة الدفع الحساسة")}
            description={copy(
              "A manual reveal is audited and uses the immutable payout beneficiary. It is hidden after 60 seconds, when this page is hidden or when you leave.",
              "كشف بيانات الصرف اليدوي مُدقّق ويستخدم المستفيد الأصلي للعملية. تُخفى البيانات بعد ٦٠ ثانية، وعند إخفاء الصفحة أو مغادرتها.",
            )}
          >
            {detail.destinationRevealAllowed ? (
              <>
                <TextAreaField
                  id="payout-reveal-reason"
                  label={copy("Reason for revealing payout destination", "سبب كشف جهة الصرف")}
                  value={revealReason}
                  maxLength={500}
                  disabled={disabled}
                  onChange={(e) => setRevealReason(e.target.value)}
                />
                <ActionButton
                  tone="danger"
                  disabled={disabled || revealReason.trim().length < 8}
                  onClick={() => void act("reveal")}
                >
                  {copy("Reveal sensitive destination", "كشف جهة الدفع الحساسة")}
                </ActionButton>
              </>
            ) : (
              <p>
                {copy(
                  "Reveal is unavailable for this saved payout status or snapshot.",
                  "الكشف غير متاح لحالة الصرف المحفوظة أو لقطة المستفيد هذه.",
                )}
              </p>
            )}
            {revealed && (
              <section aria-label={copy("Revealed destination", "جهة الدفع المكشوفة")}>
                <p dir="auto">{revealed.legalName}</p>
                <pre ref={sensitive} dir="auto" className={styles.sensitive}>
                  {revealed.destination}
                </pre>
                <ActionButton tone="secondary" onClick={hideSensitive}>
                  {copy("Hide destination now", "إخفاء جهة الدفع الآن")}
                </ActionButton>
              </section>
            )}
          </FormSection>
        </div>
      )}
    </div>
  );
}
