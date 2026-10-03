"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  PageHeader,
  StatusNotice,
  MetricList,
  TextField,
  TextAreaField,
  SelectField,
  FormSection,
  DataBadge,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import { EditorTabs } from "@/components/ui/editor-tabs";
import {
  FinanceReconciliation,
  emptyFinanceReportDraft,
  financeReportCommand,
  type FinanceReportDraft,
  type FinanceReportFilters,
} from "./admin-finance-reconciliation";
import type { AdminSession } from "@/lib/admin-control";
import { exactFinanceMoney } from "@/lib/creator-finance";
import {
  AdminFinanceError,
  financeBps,
  financeComplianceStates,
  financeDisputeStates,
  financePayoutStates,
  financeManualPayoutChoices,
  getAdminFinanceSnapshot,
  getFinanceActions,
  getFinanceTarget,
  saveAdminFinance,
  searchFinanceTargets,
  reviewFinanceCommand,
  getFinanceReconciliation,
  getFinanceReportDetail,
  type AdminFinanceSnapshot,
  type FinanceAcknowledgment,
  type FinanceChannelTarget,
  type FinanceCommand,
  type FinanceFilters,
  type FinanceTargetSnapshot,
} from "@/lib/admin-finance-workspace";
import styles from "./admin-finance.module.css";

type ChannelDraft = {
  share: string;
  contractStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
  effectiveFrom: string;
  effectiveTo: string;
  termsVersion: string;
  currency: string;
  adjustment: string;
  reason: string;
  source: string;
  importState: "ESTIMATED" | "FINAL";
  periodStart: string;
  periodEnd: string;
  gross: string;
  adSource: string;
  memo: string;
  key: string;
  complianceField: "IDENTITY" | "TAX" | "PAYOUT_DESTINATION";
  complianceStatus: (typeof financeComplianceStates)[number];
  complianceReason: string;
};
type RetainedChannel = { value: ChannelDraft; dirty: Record<string, boolean> };
type DecisionDraft = {
  status: string;
  reason: string;
  resolution: string;
  externalReference: string;
  failureReason: string;
  dirty: boolean;
};
const initialFilters: FinanceFilters = {
  ledgerPage: 1,
  ledgerChannelId: "",
  payoutPage: 1,
  payoutStatus: "",
  disputeStatus: "",
};
function freshChannel(channel: FinanceChannelTarget): RetainedChannel {
  return {
    dirty: {},
    value: {
      share: "",
      contractStatus: "ACTIVE",
      effectiveFrom: "",
      effectiveTo: "",
      termsVersion: "",
      currency: channel.payoutProfile?.preferredCurrency ?? "",
      adjustment: "",
      reason: "",
      source: "",
      importState: "FINAL",
      periodStart: "",
      periodEnd: "",
      gross: "",
      adSource: "",
      memo: "",
      key: `admin-${crypto.randomUUID()}`,
      complianceField: "IDENTITY",
      complianceStatus: "NOT_STARTED",
      complianceReason: "",
    },
  };
}
function iso(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error("Invalid date");
  return new Date(value).toISOString();
}
function thresholdAmount(micros: string) {
  const amount = BigInt(micros);
  return `${amount / 1000000n}.${String(amount % 1000000n).padStart(6, "0")}`;
}
function thresholdMicros(value: string) {
  if (!/^\d{1,122}(?:\.\d{1,6})?$/.test(value.trim())) throw new Error("Invalid threshold");
  const [whole = "0", part = ""] = value.trim().split(".");
  return String(BigInt(whole) * 1000000n + BigInt(part.padEnd(6, "0")));
}
function FinancePager({
  page,
  pages,
  summary,
  name,
  previous,
  next,
  busy,
  onChange,
}: {
  page: number;
  pages: number;
  summary: string;
  name: string;
  previous: string;
  next: string;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <PageControls
      label={name}
      summary={summary}
      previousLabel={previous}
      nextLabel={next}
      hasPrevious={!busy && page > 1}
      hasNext={!busy && page < pages}
      onPrevious={() => onChange(page - 1)}
      onNext={() => onChange(page + 1)}
    />
  );
}
export function AdminFinanceWorkspace() {
  const { locale, href, formatNumber, formatDate } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const privateBody = useRef<HTMLDivElement | null>(null);
  const [privateGeneration, setPrivateGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<AdminFinanceSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [readError, setReadError] = useState(false),
    [denied, setDenied] = useState(false),
    [tab, setTab] = useState("overview"),
    [applied, setApplied] = useState(initialFilters),
    [payoutFilter, setPayoutFilter] = useState(""),
    [disputeFilter, setDisputeFilter] = useState(""),
    [ledgerFilter, setLedgerFilter] = useState(""),
    [settingsDraft, setSettingsDraft] = useState<{
      share: string;
      threshold: string;
      dirty: boolean;
    } | null>(null),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<FinanceChannelTarget[]>([]),
    [selected, setSelected] = useState<FinanceChannelTarget | null>(null),
    [target, setTarget] = useState<FinanceTargetSnapshot | null>(null),
    [channels, setChannels] = useState<Record<string, RetainedChannel>>({}),
    [payoutDrafts, setPayoutDrafts] = useState<Record<string, DecisionDraft>>({}),
    [disputeDrafts, setDisputeDrafts] = useState<Record<string, DecisionDraft>>({}),
    [ack, setAck] = useState<FinanceAcknowledgment | null>(null),
    [notice, setNotice] = useState<
      "saved" | "invalid" | "uncertain" | "conflict" | "verification" | null
    >(null),
    [locked, setLocked] = useState(false),
    [reviewCommand, setReviewCommand] = useState<FinanceCommand | null>(null),
    [reviewRecord, setReviewRecord] = useState<Awaited<
      ReturnType<typeof reviewFinanceCommand>
    > | null>(null),
    [reviewed, setReviewed] = useState(false),
    [actions, setActions] = useState<Awaited<ReturnType<typeof getFinanceActions>> | null>(null),
    [disputePage, setDisputePage] = useState(1),
    [contractPage, setContractPage] = useState(1),
    [actionPage, setActionPage] = useState(1),
    [reportDraft, setReportDraft] = useState<FinanceReportDraft>(emptyFinanceReportDraft),
    [reportData, setReportData] = useState<Awaited<
      ReturnType<typeof getFinanceReconciliation>
    > | null>(null),
    [reportDetail, setReportDetail] = useState<Awaited<
      ReturnType<typeof getFinanceReportDetail>
    > | null>(null),
    [reportFilters, setReportFilters] = useState<FinanceReportFilters>({
      source: "",
      status: "",
      page: 1,
    }),
    [appliedReportFilters, setAppliedReportFilters] = useState<FinanceReportFilters>({
      source: "",
      status: "",
      page: 1,
    }),
    [reportRowPage, setReportRowPage] = useState(1);
  const actor = useRef<AdminSession | null>(null),
    operation = useRef(false),
    decisionLocked = useRef(false),
    controller = useRef<AbortController | null>(null),
    dirty = useRef(false),
    channelRef = useRef<Record<string, RetainedChannel>>({}),
    settingsRef = useRef<typeof settingsDraft>(null),
    payoutRef = useRef<Record<string, DecisionDraft>>({}),
    disputeRef = useRef<Record<string, DecisionDraft>>({});
  const clearActor = useCallback(() => {
    actor.current = null;
    channelRef.current = {};
    settingsRef.current = null;
    payoutRef.current = {};
    disputeRef.current = {};
    decisionLocked.current = true;
    setSnapshot(null);
    setSelected(null);
    setTarget(null);
    setMatches([]);
    setActions(null);
    setChannels({});
    setSettingsDraft(null);
    setPayoutDrafts({});
    setDisputeDrafts({});
    setAck(null);
    setDenied(true);
    setNotice(null);
    setLocked(true);
    setReviewed(false);
    setReviewCommand(null);
    setReviewRecord(null);
    setReportDraft(emptyFinanceReportDraft);
    setReportData(null);
    setReportDetail(null);
    setReportFilters({ source: "", status: "", page: 1 });
    setAppliedReportFilters({ source: "", status: "", page: 1 });
    setQuery("");
    setLedgerFilter("");
  }, []);
  const readSnapshot = useCallback(
    async (filters: FinanceFilters) => {
      if (operation.current) return;
      operation.current = true;
      const pending = new AbortController();
      controller.current = pending;
      setLoading(true);
      setReadError(false);
      setSnapshot(null);
      try {
        const next = await getAdminFinanceSnapshot(
          filters,
          pending.signal,
          actor.current ?? undefined,
        );
        if (pending.signal.aborted) return;
        if (privateBody.current?.hidden) setPrivateGeneration((value) => value + 1);
        actor.current = next.session;
        setSnapshot(next);
        setApplied(filters);
        setDenied(false);
        if (!settingsRef.current) {
          const value = {
            share: String(next.settings.defaultCreatorRevenueShareBps),
            threshold: thresholdAmount(next.settings.payoutThresholdMicros),
            dirty: false,
          };
          settingsRef.current = value;
          setSettingsDraft(value);
        }
      } catch (error) {
        if (!pending.signal.aborted) {
          if (error instanceof AdminFinanceError && [401, 403].includes(error.status)) clearActor();
          else setReadError(true);
        }
      } finally {
        if (controller.current === pending) {
          controller.current = null;
          operation.current = false;
          setLoading(false);
        }
      }
    },
    [clearActor],
  );
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void readSnapshot(initialFilters);
    });
    const hide = () => {
      const pending = controller.current;
      controller.current = null;
      operation.current = false;
      pending?.abort();
      if (privateBody.current) privateBody.current.hidden = true;
      setLoading(false);
      setBusy(false);
      setReadError(true);
      setSnapshot(null);
      setTarget(null);
      setMatches([]);
      setActions(null);
      setAck(null);
      setReportData(null);
      setReportDetail(null);
      setReviewRecord(null);
      decisionLocked.current = true;
      setLocked(true);
      setReviewed(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setReadError(true);
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      controller.current?.abort();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", restore);
    };
  }, [readSnapshot]);
  useEffect(() => {
    dirty.current =
      busy ||
      locked ||
      Boolean(settingsDraft?.dirty) ||
      reportDraft.dirty ||
      Object.values(channels).some((r) => Object.values(r.dirty).some(Boolean)) ||
      Object.values(payoutDrafts).some((r) => r.dirty) ||
      Object.values(disputeDrafts).some((r) => r.dirty);
  }, [busy, locked, settingsDraft, channels, payoutDrafts, disputeDrafts, reportDraft]);
  useEffect(() => {
    const message = ar
      ? "لديك تغييرات غير محفوظة أو عملية تحتاج للمراجعة. هل تريد المغادرة؟"
      : "You have unsaved changes or a decision awaiting review. Leave this page?";
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const leave = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (
        !dirty.current ||
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0 ||
        anchor.href === location.href
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [ar]);
  async function runRead(task: (signal: AbortSignal, session: AdminSession) => Promise<void>) {
    if (operation.current || !actor.current) return;
    operation.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setReadError(false);
    try {
      await task(pending.signal, actor.current);
    } catch (error) {
      if (!pending.signal.aborted) {
        if (error instanceof AdminFinanceError && [401, 403].includes(error.status)) clearActor();
        else setReadError(true);
      }
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  function editChannel<K extends keyof ChannelDraft>(key: K, value: ChannelDraft[K], kind: string) {
    if (!selected) return;
    const current = channelRef.current[selected.id];
    if (!current) return;
    const next = {
      ...channelRef.current,
      [selected.id]: {
        value: { ...current.value, [key]: value },
        dirty: { ...current.dirty, [kind]: true },
      },
    };
    dirty.current = true;
    channelRef.current = next;
    setChannels(next);
  }
  function editDecision(
    kind: "payout" | "dispute",
    id: string,
    base: DecisionDraft,
    key: keyof DecisionDraft,
    value: string,
  ) {
    const ref = kind === "payout" ? payoutRef : disputeRef,
      next = { ...ref.current, [id]: { ...base, [key]: value, dirty: true } };
    dirty.current = true;
    ref.current = next;
    (kind === "payout" ? setPayoutDrafts : setDisputeDrafts)(next);
  }
  async function selectChannel(channel: FinanceChannelTarget) {
    if (operation.current) return;
    setSelected(channel);
    setTarget(null);
    setContractPage(1);
    if (!channelRef.current[channel.id]) {
      channelRef.current = { ...channelRef.current, [channel.id]: freshChannel(channel) };
      setChannels(channelRef.current);
    }
    await runRead(async (signal, session) => {
      const next = await getFinanceTarget(channel.id, session, signal);
      if (!signal.aborted) setTarget(next);
    });
  }
  async function save(command: FinanceCommand) {
    if (operation.current || decisionLocked.current || !actor.current) return;
    operation.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    dirty.current = true;
    try {
      const result = await saveAdminFinance(command, actor.current, pending.signal);
      if (pending.signal.aborted) return;
      setAck(result);
      setNotice("saved");
      setReviewed(false);
      if (command.kind === "reportImport")
        setReportDraft((value) => ({ ...value, payload: "", dirty: false }));
      if (command.kind === "settings" && settingsRef.current) {
        settingsRef.current = { ...settingsRef.current, dirty: false };
        setSettingsDraft(settingsRef.current);
      }
      const channelId =
        command.kind === "adjustment"
          ? command.input.channelId
          : command.kind === "import"
            ? command.input.entries[0].channelId
            : "channelId" in command
              ? command.channelId
              : null;
      if (channelId && channelRef.current[channelId]) {
        const row = channelRef.current[channelId],
          flags = { ...row.dirty };
        delete flags[command.kind];
        const value = { ...row.value };
        if (command.kind === "adjustment") {
          value.reason = "";
          value.adjustment = "";
        }
        if (command.kind === "compliance") value.complianceReason = "";
        if (command.kind === "import") {
          value.key = `admin-${crypto.randomUUID()}`;
          value.gross = "";
          value.memo = "";
        }
        channelRef.current = { ...channelRef.current, [channelId]: { value, dirty: flags } };
        setChannels(channelRef.current);
      }
      if (command.kind === "payoutStatus" && payoutRef.current[command.base.id]) {
        payoutRef.current = {
          ...payoutRef.current,
          [command.base.id]: { ...payoutRef.current[command.base.id]!, reason: "", dirty: false },
        };
        setPayoutDrafts(payoutRef.current);
      }
      if (command.kind === "dispute" && disputeRef.current[command.base.id]) {
        disputeRef.current = {
          ...disputeRef.current,
          [command.base.id]: { ...disputeRef.current[command.base.id]!, reason: "", dirty: false },
        };
        setDisputeDrafts(disputeRef.current);
      }
    } catch (error) {
      if (error instanceof AdminFinanceError && error.verificationRequired)
        setNotice("verification");
      else if (error instanceof AdminFinanceError && [401, 403].includes(error.status))
        clearActor();
      else if (error instanceof AdminFinanceError && !error.writeStarted) setNotice("invalid");
      else {
        decisionLocked.current = true;
        setReviewCommand(command);
        setReviewRecord(null);
        setLocked(true);
        setReviewed(false);
        setNotice(
          error instanceof AdminFinanceError && error.status === 409 ? "conflict" : "uncertain",
        );
      }
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function review() {
    await runRead(async (signal, session) => {
      setReviewed(false);
      const [next, ledger, current, decision] = await Promise.all([
        getAdminFinanceSnapshot(applied, signal, session),
        getFinanceActions(session, signal),
        selected ? getFinanceTarget(selected.id, session, signal) : Promise.resolve(null),
        reviewCommand
          ? reviewFinanceCommand(reviewCommand, session, signal)
          : Promise.resolve(null),
      ]);
      if (signal.aborted) return;
      setSnapshot(next);
      setActions(ledger);
      setTarget(current);
      setReviewRecord(decision);
      setReviewed(true);
      setActionPage(1);
    });
  }
  async function readReports(filters: FinanceReportFilters) {
    if (operation.current) return;
    setReportData(null);
    await runRead(async (signal, session) => {
      const result = await getFinanceReconciliation(filters, session, signal);
      if (!signal.aborted) {
        setReportData(result);
        setAppliedReportFilters(filters);
      }
    });
  }
  function editReport(value: Partial<FinanceReportDraft>) {
    dirty.current = true;
    setReportDraft((previous) => ({ ...previous, ...value, dirty: true }));
  }
  const labels: Record<string, string> = {
    PENDING: copy("Pending", "قيد الانتظار"),
    PROCESSING: copy("Processing", "قيد التنفيذ"),
    PAID: copy("Paid", "مدفوع"),
    FAILED: copy("Failed", "فشل"),
    CANCELLED: copy("Cancelled", "ملغى"),
    OPEN: copy("Open", "مفتوح"),
    REVIEWING: copy("Under review", "قيد المراجعة"),
    RESOLVED: copy("Resolved", "تم الحل"),
    REJECTED: copy("Rejected", "مرفوض"),
    NOT_STARTED: copy("Not started", "لم يبدأ"),
    VERIFIED: copy("Verified", "تم التحقق"),
    REQUIRES_ACTION: copy("Action required", "يتطلب إجراء"),
    ACTIVE: copy("Active", "نشط"),
    SUSPENDED: copy("Suspended", "موقوف"),
    ENDED: copy("Ended", "منتهي"),
    ESTIMATED: copy("Estimated", "تقديري"),
    FINAL: copy("Final", "نهائي"),
    AD_REVENUE: copy("Advertising revenue", "إيرادات الإعلانات"),
    ADJUSTMENT: copy("Adjustment", "تسوية"),
    REVERSAL: copy("Reversal", "عكس قيد"),
    PAYOUT: copy("Payout", "صرف"),
    IDENTITY: copy("Identity", "الهوية"),
    TAX: copy("Tax", "الضرائب"),
    PAYOUT_DESTINATION: copy("Payment destination", "جهة الدفع"),
    READY: copy("Ready", "جاهز"),
    SUBMITTING: copy("Submitting", "جارٍ الإرسال"),
    SUBMISSION_UNKNOWN: copy("Submission needs review", "الإرسال يحتاج مراجعة"),
    SUBMITTED: copy("Submitted", "تم الإرسال"),
    CANCEL_REQUESTED: copy("Cancellation requested", "تم طلب الإلغاء"),
    COMPLETED: copy("Completed", "مكتمل"),
    UNKNOWN: copy("Needs review", "يحتاج مراجعة"),
    settings: copy("Global defaults", "الإعدادات العامة"),
    contract: copy("Channel contract", "عقد القناة"),
    adjustment: copy("Revenue adjustment", "تسوية الإيراد"),
    import: copy("Revenue entry import", "استيراد قيد الإيراد"),
    payout: copy("Payout creation", "إنشاء صرف"),
    payoutStatus: copy("Payout decision", "قرار الصرف"),
    dispute: copy("Dispute decision", "قرار النزاع"),
    compliance: copy("Compliance decision", "قرار الامتثال"),
    reportImport: copy("Report reconciliation", "مطابقة التقرير"),
    REVENUE_SETTINGS_UPDATED: copy("Revenue defaults updated", "تحديث إعدادات الإيرادات"),
    CREATOR_CONTRACT_CREATED: copy("Channel contract created", "إنشاء عقد القناة"),
    REVENUE_IMPORTED: copy("Revenue entries imported", "استيراد قيود الإيرادات"),
    REVENUE_ADJUSTMENT_CREATED: copy("Revenue adjustment recorded", "تسجيل تسوية الإيراد"),
    PAYOUT_CREATED: copy("Payout created", "إنشاء عملية صرف"),
    PAYOUT_STATUS_UPDATED: copy("Payout status updated", "تحديث حالة الصرف"),
    "revenue.dispute_updated": copy("Dispute decision recorded", "تسجيل قرار النزاع"),
    "creator.compliance_status_overridden": copy(
      "Compliance decision recorded",
      "تسجيل قرار الامتثال",
    ),
    REVENUE_REPORT_RECONCILED: copy("Source report reconciled", "مطابقة تقرير المصدر"),
    channelId: copy("Channel ID", "معرّف القناة"),
    payoutId: copy("Payout ID", "معرّف الصرف"),
    paymentProfileId: copy("Payment profile ID", "معرّف ملف الدفع"),
    videoId: copy("Video ID", "معرّف الفيديو"),
    campaignId: copy("Campaign ID", "معرّف الحملة"),
    amount: copy("Amount", "المبلغ"),
    currency: copy("Currency", "العملة"),
    source: copy("Source", "المصدر"),
    sourceReportId: copy("Source report reference", "مرجع تقرير المصدر"),
    provider: copy("Provider", "المزود"),
    requestSource: copy("Requested by", "مصدر الطلب"),
    status: copy("Status", "الحالة"),
    from: copy("Previous status", "الحالة السابقة"),
    to: copy("New status", "الحالة الجديدة"),
    field: copy("Verification field", "مجال التحقق"),
    effectiveFrom: copy("Effective from", "يسري من"),
    effectiveTo: copy("Effective until", "يسري حتى"),
    defaultCreatorRevenueShareBps: copy(
      "Default share (basis points)",
      "الحصة الافتراضية (نقاط أساس)",
    ),
    revenueShareBps: copy("Creator share (basis points)", "حصة المنشئ (نقاط أساس)"),
    payoutThresholdMicros: copy("Payout threshold", "حد الصرف"),
    created: copy("Created entries", "القيود المنشأة"),
    duplicates: copy("Duplicate entries", "القيود المكررة"),
    requested: copy("Requested entries", "القيود المطلوبة"),
    entryCount: copy("Reserved entries", "القيود المحجوزة"),
    totalRows: copy("Total rows", "إجمالي الصفوف"),
    matchedRows: copy("Matched rows", "الصفوف المطابقة"),
    unmatchedRows: copy("Unmatched rows", "الصفوف غير المطابقة"),
    duplicateRows: copy("Duplicate rows", "الصفوف المكررة"),
    correctedRows: copy("Corrected rows", "الصفوف المصححة"),
    finalizedRows: copy("Finalized rows", "الصفوف النهائية"),
    anomalousRows: copy("Rows needing review", "صفوف تحتاج مراجعة"),
    beneficiarySnapshotted: copy("Beneficiary snapshot recorded", "تسجيل نسخة المستفيد"),
    rawIdentityDataAccessed: copy("Raw identity data accessed", "الوصول لبيانات الهوية الخام"),
    taxIdentifierAccessed: copy("Tax identifier accessed", "الوصول للمعرّف الضريبي"),
    bankDataAccessed: copy("Bank data accessed", "الوصول للبيانات البنكية"),
    automaticProviderSyncConfigured: copy(
      "Automatic provider sync configured",
      "إعداد المزامنة التلقائية مع المزود",
    ),
    ADMIN: copy("Administration", "الإدارة"),
    CREATOR: copy("Creator", "المنشئ"),
  };
  const label = (value: string) => labels[value] ?? value,
    disabled = busy || loading || locked || denied || !snapshot,
    draft = selected ? channels[selected.id]?.value : null,
    targetReady = Boolean(selected && target?.channelId === selected.id),
    amount = (currency: string, value: string) => (
      <bdi className={styles.money}>{exactFinanceMoney(currency, value)}</bdi>
    );
  const options = (values: readonly string[]) =>
    values.map((value) => (
      <option key={value} value={value}>
        {label(value)}
      </option>
    ));
  function channelField(
    key: keyof ChannelDraft,
    title: string,
    kind: string,
    type = "text",
    maxLength = 500,
  ) {
    return (
      <TextField
        id={`finance-${kind}-${key}`}
        label={title}
        value={draft?.[key] ?? ""}
        type={type}
        maxLength={maxLength}
        onChange={(event) => editChannel(key, event.target.value as ChannelDraft[typeof key], kind)}
      />
    );
  }
  const submit = (build: () => FinanceCommand) => {
    if (operation.current || decisionLocked.current) return;
    try {
      void save(build());
    } catch {
      setNotice("invalid");
    }
  };
  const channelForms =
    selected && draft ? (
      <div className={styles.list}>
        <h2 dir="auto">
          {selected.name} <bdi>@{selected.handle}</bdi>
        </h2>
        {!targetReady ? (
          <StatusNotice title={copy("Channel details unavailable", "تفاصيل القناة غير متاحة")}>
            <ActionButton disabled={busy} onClick={() => void selectChannel(selected)}>
              {copy("Read this channel", "قراءة هذه القناة")}
            </ActionButton>
          </StatusNotice>
        ) : (
          <>
            <MetricList
              label={copy("Channel finance facts", "بيانات مالية القناة")}
              items={[
                {
                  label: copy(
                    "Inherited creator share (basis points)",
                    "الحصة الافتراضية للمنشئ (نقاط أساس)",
                  ),
                  value: formatNumber(target!.defaultRevenueShareBps),
                },
                {
                  label: copy("Identity", "الهوية"),
                  value: label(target!.compliance.identity.status),
                },
                { label: copy("Tax", "الضرائب"), value: label(target!.compliance.tax.status) },
                {
                  label: copy("Payment destination", "جهة الدفع"),
                  value: label(target!.compliance.payoutDestination.status),
                },
              ]}
            />
            <Disclosure
              summary={copy(
                "Payout eligibility and provider requirements",
                "أهلية الصرف ومتطلبات المزود",
              )}
            >
              <dl className={styles.facts}>
                {[
                  [
                    copy("Compliance eligible", "مؤهل من ناحية الامتثال"),
                    target!.compliance.payoutComplianceEligible,
                  ],
                  [
                    copy("Identity required", "التحقق من الهوية مطلوب"),
                    target!.compliance.identity.required,
                  ],
                  [
                    copy("Tax verification required", "التحقق الضريبي مطلوب"),
                    target!.compliance.tax.required,
                  ],
                  [
                    copy("Destination verification required", "التحقق من جهة الدفع مطلوب"),
                    target!.compliance.payoutDestination.required,
                  ],
                  [
                    copy("Payment destination configured", "جهة الدفع مضبوطة"),
                    target!.compliance.payoutDestination.configured,
                  ],
                  [
                    copy("Provider connected", "المزود متصل"),
                    target!.compliance.provider.connected,
                  ],
                  [
                    copy("Production enabled", "الإنتاج مفعّل"),
                    target!.compliance.provider.productionEnabled,
                  ],
                  [
                    copy("External identity workflow", "إجراء خارجي للهوية"),
                    target!.compliance.provider.externalIdentityWorkflow,
                  ],
                  [
                    copy("External tax workflow", "إجراء خارجي للضرائب"),
                    target!.compliance.provider.externalTaxWorkflow,
                  ],
                  [
                    copy("Identity action available", "إجراء الهوية متاح"),
                    target!.compliance.identity.actionAvailable,
                  ],
                  [
                    copy("Tax action available", "إجراء الضرائب متاح"),
                    target!.compliance.tax.actionAvailable,
                  ],
                ].map(([title, value]) => (
                  <div key={String(title)}>
                    <dt>{title}</dt>
                    <dd>{value ? copy("Yes", "نعم") : copy("No", "لا")}</dd>
                  </div>
                ))}
                <div>
                  <dt>{copy("Provider", "المزود")}</dt>
                  <dd>
                    <bdi>{target!.compliance.provider.name}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{copy("Requirements source", "مصدر المتطلبات")}</dt>
                  <dd>
                    {target!.compliance.requirements.source === "NONE"
                      ? copy("No configured requirements", "لا توجد متطلبات مضبوطة")
                      : target!.compliance.requirements.source === "PROVIDER"
                        ? copy("Provider", "المزود")
                        : copy("Approved legal configuration", "إعداد قانوني معتمد")}
                  </dd>
                </div>
                <div>
                  <dt>{copy("Requirements version", "نسخة المتطلبات")}</dt>
                  <dd>
                    <bdi>
                      {target!.compliance.requirements.version ??
                        copy("No version returned", "لم تُرجع نسخة")}
                    </bdi>
                  </dd>
                </div>
                <div>
                  <dt>{copy("Masked payment destination", "جهة الدفع المحجوبة")}</dt>
                  <dd>
                    <bdi>
                      {target!.compliance.payoutDestination.masked ??
                        copy("Not configured", "غير مضبوطة")}
                    </bdi>
                  </dd>
                </div>
                <div>
                  <dt>{copy("Last checked", "آخر تحقق")}</dt>
                  <dd>
                    {target!.compliance.lastCheckedAt
                      ? formatDate(target!.compliance.lastCheckedAt)
                      : copy("No check time returned", "لم يُرجع وقت تحقق")}
                  </dd>
                </div>
              </dl>
              {target!.compliance.actionsRequired.length ? (
                <ul>
                  {target!.compliance.actionsRequired.map((action, index) => (
                    <li key={index} dir="auto">
                      {action}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {copy(
                    "No required actions returned. Eligibility is checked again by the server when creating a payout.",
                    "لم تُرجع إجراءات مطلوبة. يتحقق الخادم مجددًا من الأهلية عند إنشاء عملية صرف.",
                  )}
                </p>
              )}
              <p>
                {copy(
                  "Compliance eligibility does not confirm an available balance or a completed payment.",
                  "أهلية الامتثال لا تؤكد وجود رصيد متاح أو إتمام دفعة.",
                )}
              </p>
            </Disclosure>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit(() => ({
                  kind: "contract",
                  channelId: selected.id,
                  input: {
                    revenueShareBps: financeBps(draft.share),
                    effectiveFrom: iso(draft.effectiveFrom),
                    effectiveTo: draft.effectiveTo ? iso(draft.effectiveTo) : null,
                    termsVersion: draft.termsVersion.trim() || null,
                    status: draft.contractStatus,
                  },
                }));
              }}
            >
              <FormSection
                id="finance-section-1"
                legend={copy("New channel contract", "عقد جديد للقناة")}
                description={copy(
                  "An empty share is not zero. Enter an explicit share and effective date; existing contracts stay in history.",
                  "الحصة الفارغة ليست صفرًا. أدخل الحصة وتاريخ السريان؛ تظل العقود السابقة في السجل.",
                )}
              >
                <fieldset disabled={disabled || !targetReady}>
                  <div className={styles.grid}>
                    {channelField(
                      "share",
                      copy(
                        "Creator share (0–10000 basis points)",
                        "حصة المنشئ (٠–١٠٠٠٠ نقطة أساس)",
                      ),
                      "contract",
                      "text",
                      5,
                    )}
                    <SelectField
                      id="finance-contract-status"
                      label={copy("Contract status", "حالة العقد")}
                      value={draft.contractStatus}
                      onChange={(event) =>
                        editChannel(
                          "contractStatus",
                          event.target.value as ChannelDraft["contractStatus"],
                          "contract",
                        )
                      }
                    >
                      {options(["PENDING", "ACTIVE", "SUSPENDED", "ENDED"])}
                    </SelectField>
                    {channelField(
                      "effectiveFrom",
                      copy("Effective from", "يسري من"),
                      "contract",
                      "datetime-local",
                    )}
                    {channelField(
                      "effectiveTo",
                      copy("Effective until (optional)", "يسري حتى (اختياري)"),
                      "contract",
                      "datetime-local",
                    )}
                    {channelField(
                      "termsVersion",
                      copy("Terms version (optional)", "نسخة الشروط (اختياري)"),
                      "contract",
                      "text",
                      80,
                    )}
                  </div>
                  <ActionButton type="submit">
                    {copy("Create contract", "إنشاء العقد")}
                  </ActionButton>
                </fieldset>
              </FormSection>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit(() => ({
                  kind: "adjustment",
                  input: {
                    channelId: selected.id,
                    amount: draft.adjustment,
                    currency: draft.currency.trim().toUpperCase(),
                    reason: draft.reason,
                  },
                }));
              }}
            >
              <FormSection
                id="finance-section-2"
                legend={copy("Revenue adjustment", "تسوية الإيرادات")}
              >
                <fieldset disabled={disabled || !targetReady}>
                  <div className={styles.grid}>
                    {channelField("currency", copy("Currency", "العملة"), "adjustment", "text", 3)}
                    {channelField(
                      "adjustment",
                      copy(
                        "Signed amount (up to six decimals)",
                        "المبلغ بإشارته (حتى ٦ منازل عشرية)",
                      ),
                      "adjustment",
                      "text",
                      22,
                    )}
                    {channelField(
                      "reason",
                      copy("Reason (8–500 characters)", "السبب (٨–٥٠٠ حرف)"),
                      "adjustment",
                    )}
                  </div>
                  <ActionButton type="submit">
                    {copy("Record adjustment", "تسجيل التسوية")}
                  </ActionButton>
                </fieldset>
              </FormSection>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit(() => ({
                  kind: "import",
                  input: {
                    source: draft.source.trim(),
                    entries: [
                      {
                        idempotencyKey: draft.key,
                        channelId: selected.id,
                        periodStart: iso(draft.periodStart),
                        periodEnd: iso(draft.periodEnd),
                        grossAmount: draft.gross,
                        currency: draft.currency.trim().toUpperCase(),
                        state: draft.importState,
                        adSource: draft.adSource.trim() || null,
                        memo: draft.memo.trim() || null,
                      },
                    ],
                  },
                }));
              }}
            >
              <FormSection
                id="finance-section-3"
                legend={copy("Import a revenue entry", "استيراد قيد إيرادات")}
                description={copy(
                  "The retained import reference prevents the same entry from being recorded twice. Keep it when reviewing an interrupted request.",
                  "مرجع الاستيراد المحفوظ يمنع تسجيل القيد نفسه مرتين. احتفظ به عند مراجعة طلب انقطع ردّه.",
                )}
              >
                <fieldset disabled={disabled || !targetReady}>
                  <div className={styles.grid}>
                    {channelField(
                      "source",
                      copy("Report source", "مصدر التقرير"),
                      "import",
                      "text",
                      80,
                    )}
                    {channelField(
                      "key",
                      copy("Import reference", "مرجع الاستيراد"),
                      "import",
                      "text",
                      160,
                    )}
                    {channelField(
                      "periodStart",
                      copy("Period start", "بداية الفترة"),
                      "import",
                      "datetime-local",
                    )}
                    {channelField(
                      "periodEnd",
                      copy("Period end", "نهاية الفترة"),
                      "import",
                      "datetime-local",
                    )}
                    {channelField(
                      "gross",
                      copy("Gross revenue", "الإيراد الإجمالي"),
                      "import",
                      "text",
                      22,
                    )}
                    {channelField("currency", copy("Currency", "العملة"), "import", "text", 3)}
                    <SelectField
                      id="finance-import-state"
                      label={copy("Entry state", "حالة القيد")}
                      value={draft.importState}
                      onChange={(event) =>
                        editChannel(
                          "importState",
                          event.target.value as ChannelDraft["importState"],
                          "import",
                        )
                      }
                    >
                      {options(["ESTIMATED", "FINAL"])}
                    </SelectField>
                    {channelField(
                      "adSource",
                      copy("Advertising source (optional)", "مصدر الإعلان (اختياري)"),
                      "import",
                      "text",
                      80,
                    )}
                    {channelField("memo", copy("Memo (optional)", "ملاحظة (اختياري)"), "import")}
                  </div>
                  <ActionButton type="submit">{copy("Import entry", "استيراد القيد")}</ActionButton>
                </fieldset>
              </FormSection>
            </form>
            <FormSection
              id="finance-section-4"
              legend={copy("Create payout", "إنشاء عملية صرف")}
              description={copy(
                "The channel's stored payment profile and current eligibility determine the provider and amount.",
                "ملف الدفع المحفوظ للقناة وأهليتها الحالية يحددان المزود والمبلغ.",
              )}
            >
              <fieldset disabled={disabled || !targetReady}>
                {channelField("currency", copy("Currency", "العملة"), "payout", "text", 3)}
                <ActionButton
                  onClick={() =>
                    submit(() => ({
                      kind: "payout",
                      channelId: selected.id,
                      currency: draft.currency.trim().toUpperCase(),
                    }))
                  }
                >
                  {copy("Create payout", "إنشاء عملية صرف")}
                </ActionButton>
              </fieldset>
            </FormSection>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submit(() => ({
                  kind: "compliance",
                  channelId: selected.id,
                  input: {
                    field: draft.complianceField,
                    status: draft.complianceStatus,
                    reason: draft.complianceReason,
                  },
                }));
              }}
            >
              <FormSection
                id="finance-section-5"
                legend={copy("Compliance decision", "قرار الامتثال")}
              >
                <fieldset disabled={disabled || !targetReady}>
                  <div className={styles.grid}>
                    <SelectField
                      id="finance-compliance-field"
                      label={copy("Verification field", "مجال التحقق")}
                      value={draft.complianceField}
                      onChange={(event) =>
                        editChannel(
                          "complianceField",
                          event.target.value as ChannelDraft["complianceField"],
                          "compliance",
                        )
                      }
                    >
                      {options(["IDENTITY", "TAX", "PAYOUT_DESTINATION"])}
                    </SelectField>
                    <SelectField
                      id="finance-compliance-status"
                      label={copy("New status", "الحالة الجديدة")}
                      value={draft.complianceStatus}
                      onChange={(event) =>
                        editChannel(
                          "complianceStatus",
                          event.target.value as ChannelDraft["complianceStatus"],
                          "compliance",
                        )
                      }
                    >
                      {options(financeComplianceStates)}
                    </SelectField>
                    {channelField(
                      "complianceReason",
                      copy("Reason (8–500 characters)", "السبب (٨–٥٠٠ حرف)"),
                      "compliance",
                    )}
                  </div>
                  <ActionButton type="submit">
                    {copy("Record compliance decision", "تسجيل قرار الامتثال")}
                  </ActionButton>
                </fieldset>
              </FormSection>
            </form>
            <Disclosure
              summary={copy(
                `Contract history (${formatNumber(target!.contracts.length)})`,
                `سجل العقود (${formatNumber(target!.contracts.length)})`,
              )}
            >
              <div className={styles.list}>
                {target!.contracts.slice((contractPage - 1) * 20, contractPage * 20).map((row) => (
                  <article key={row.id} className={styles.record}>
                    <DataBadge>{label(row.status)}</DataBadge>
                    <dl className={styles.facts}>
                      <div>
                        <dt>{copy("Creator share", "حصة المنشئ")}</dt>
                        <dd>
                          {row.revenueShareBps === null
                            ? copy("Inherits the default", "يتبع القيمة الافتراضية")
                            : formatNumber(row.revenueShareBps)}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy("Effective from", "يسري من")}</dt>
                        <dd>
                          {row.effectiveFrom
                            ? formatDate(row.effectiveFrom)
                            : copy("Not specified", "غير محدد")}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy("Effective until", "يسري حتى")}</dt>
                        <dd>
                          {row.effectiveTo
                            ? formatDate(row.effectiveTo)
                            : copy("No end date", "بدون تاريخ نهاية")}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy("Terms version", "نسخة الشروط")}</dt>
                        <dd>{row.termsVersion ?? copy("Not specified", "غير محدد")}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
              <FinancePager
                page={contractPage}
                pages={Math.max(1, Math.ceil(target!.contracts.length / 20))}
                name={copy("Contract history", "سجل العقود")}
                busy={busy}
                previous={copy("Previous", "السابق")}
                next={copy("Next", "التالي")}
                summary={copy(
                  `Page ${formatNumber(contractPage)} of ${formatNumber(Math.max(1, Math.ceil(target!.contracts.length / 20)))} · ${formatNumber(target!.contracts.length)} records`,
                  `صفحة ${formatNumber(contractPage)} من ${formatNumber(Math.max(1, Math.ceil(target!.contracts.length / 20)))} · ${formatNumber(target!.contracts.length)} سجل`,
                )}
                onChange={setContractPage}
              />
            </Disclosure>
          </>
        )}
      </div>
    ) : (
      <p>
        {copy(
          "Search for a channel to manage its contracts, revenue entries, payouts and compliance.",
          "ابحث عن قناة لإدارة عقودها وقيود إيراداتها وعمليات الصرف والامتثال.",
        )}
      </p>
    );
  return (
    <div className={styles.workspace} dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        title={copy("Finance", "المالية")}
        description={copy(
          "Review revenue and payment decisions by channel. Amounts remain separate by currency.",
          "راجع الإيرادات وقرارات الدفع حسب القناة. تظل المبالغ منفصلة حسب العملة.",
        )}
        actions={
          <ActionButton
            tone="secondary"
            disabled={busy || loading}
            onClick={() => void readSnapshot(applied)}
          >
            {copy("Refresh financial records", "تحديث السجلات المالية")}
          </ActionButton>
        }
      />
      <div
        ref={privateBody}
        key={privateGeneration}
        className={styles.privateBody}
        data-private-finance-body="admin"
      >
        {denied ? (
          <StatusNotice title={copy("Finance access unavailable", "صلاحية المالية غير متاحة")}>
            {copy(
              "Sign in with an authorized Finance account before reviewing these records.",
              "سجّل الدخول بحساب مخوّل للمالية قبل مراجعة هذه السجلات.",
            )}
          </StatusNotice>
        ) : null}
        {snapshot ? (
          <p>
            {copy(
              "Financial records reflect the last explicit read; verified save acknowledgments appear separately.",
              "السجلات المالية تعرض آخر قراءة يدوية؛ تظهر تأكيدات الحفظ بشكل مستقل.",
            )}
          </p>
        ) : null}
        {loading ? (
          <StatusNotice title={copy("Loading financial records", "جارٍ تحميل السجلات المالية")}>
            {copy("Please wait.", "يرجى الانتظار.")}
          </StatusNotice>
        ) : null}
        {readError ? (
          <StatusNotice
            announce="assertive"
            title={copy("Records could not be read", "تعذرت قراءة السجلات")}
          >
            {copy(
              "Saved acknowledgments and drafts are retained. Retry the read explicitly.",
              "تظل تأكيدات الحفظ والمسودات محفوظة. أعد القراءة يدويًا.",
            )}
          </StatusNotice>
        ) : null}
        {notice ? (
          <StatusNotice
            announce="polite"
            title={
              notice === "saved"
                ? copy("Saved and acknowledged", "تم الحفظ وتأكيده")
                : notice === "invalid"
                  ? copy("Check the required fields", "راجع الحقول المطلوبة")
                  : notice === "verification"
                    ? copy("Additional verification required", "مطلوب تحقق إضافي")
                    : notice === "conflict"
                      ? copy(
                          "The decision conflicts with current records",
                          "القرار يتعارض مع السجلات الحالية",
                        )
                      : copy("The result needs review", "النتيجة تحتاج إلى مراجعة")
            }
          >
            {notice === "saved"
              ? copy(
                  "This acknowledgment remains valid if a later read fails. Refresh when you want to review the current records.",
                  "يظل هذا التأكيد محفوظًا إذا فشلت قراءة لاحقة. حدّث السجلات عندما تريد مراجعة حالتها الحالية.",
                )
              : notice === "verification"
                ? copy(
                    "Your draft is retained. Complete verification, review your decision and submit explicitly when ready.",
                    "مسودتك محفوظة. أكمل التحقق وراجع القرار، ثم أرسله يدويًا عندما تكون مستعدًا.",
                  )
                : notice === "invalid"
                  ? copy(
                      "Enter complete dates, explicit shares, exact amounts and a sufficient reason.",
                      "أدخل تواريخ كاملة وحصصًا صريحة ومبالغ دقيقة وسببًا كافيًا.",
                    )
                  : copy(
                      "The operation was not repeated. Review the current records and your recent decisions before another action.",
                      "لم تُكرر العملية. راجع السجلات الحالية وقراراتك الأخيرة قبل إجراء آخر.",
                    )}
            {ack ? (
              <div data-testid="finance-ack">
                <p>
                  {copy("Last verified operation", "آخر عملية مؤكدة")}: {label(ack.kind)}{" "}
                  {"id" in ack.record ? <bdi> · {ack.record.id}</bdi> : null}
                </p>
                {ack.kind === "payout" ||
                ack.kind === "payoutStatus" ||
                ack.kind === "adjustment" ? (
                  <p>
                    {amount(ack.record.currency, ack.record.amount)} ·{" "}
                    <bdi>{ack.record.channelId}</bdi>
                    {ack.kind !== "adjustment" ? (
                      <>
                        {" "}
                        · {label(ack.record.status)} · <bdi>{ack.record.provider}</bdi>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {ack.kind === "contract" ? (
                  <p>
                    <bdi>{ack.record.channelId}</bdi> · {copy("Creator share", "حصة المنشئ")}:{" "}
                    {ack.record.revenueShareBps === null
                      ? copy("Inherited", "افتراضية")
                      : formatNumber(ack.record.revenueShareBps)}{" "}
                    · {label(ack.record.status)}
                  </p>
                ) : null}
                {ack.kind === "settings" ? (
                  <p>
                    {copy("Default creator share", "حصة المنشئ الافتراضية")}:{" "}
                    {formatNumber(ack.record.defaultCreatorRevenueShareBps)} ·{" "}
                    {copy("Payout threshold", "حد الصرف")}:{" "}
                    <bdi>{thresholdAmount(ack.record.payoutThresholdMicros)}</bdi>
                  </p>
                ) : null}
                {ack.kind === "import" ? (
                  <p>
                    {copy("Created", "منشأ")}: {formatNumber(ack.record.created)} ·{" "}
                    {copy("Already recorded", "مسجل سابقًا")}: {formatNumber(ack.record.duplicates)}
                  </p>
                ) : null}
                {ack.kind === "dispute" ? (
                  <p>
                    {label(ack.record.status)} · <bdi>{ack.record.channelId}</bdi> ·{" "}
                    <span dir="auto">{ack.record.resolution}</span>
                  </p>
                ) : null}
                {ack.kind === "compliance" ? (
                  <p>
                    {label(ack.record.field)} · {label(ack.record.status)} ·{" "}
                    <bdi>{ack.record.compliance.channelId}</bdi>
                  </p>
                ) : null}
                {ack.kind === "reportImport" ? (
                  <p>
                    <bdi>
                      {ack.record.source} · {ack.record.sourceReportId}
                    </bdi>{" "}
                    · {formatNumber(ack.record.totalRows)} {copy("rows", "صف")}.{" "}
                    {ack.record.idempotentReplay
                      ? copy(
                          "This report was already recorded; no additional ledger rows were created.",
                          "هذا التقرير مسجل سابقًا؛ لم تُنشأ قيود إضافية.",
                        )
                      : copy(
                          "The report was recorded and reconciled.",
                          "تم تسجيل التقرير ومطابقته.",
                        )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </StatusNotice>
        ) : null}
        {locked ? (
          <StatusNotice
            title={copy("Financial writes paused for review", "عمليات التعديل متوقفة للمراجعة")}
          >
            {snapshot && reviewCommand ? (
              <p>
                {copy("Decision being reviewed", "القرار الجاري مراجعته")}:{" "}
                <bdi>
                  {reviewCommand.kind === "payoutStatus" || reviewCommand.kind === "dispute"
                    ? reviewCommand.base.id
                    : reviewCommand.kind === "adjustment"
                      ? reviewCommand.input.channelId
                      : reviewCommand.kind === "import"
                        ? reviewCommand.input.entries[0].channelId
                        : reviewCommand.kind === "reportImport"
                          ? reviewCommand.input.sourceReportId
                          : "channelId" in reviewCommand
                            ? reviewCommand.channelId
                            : copy("Global defaults", "الإعدادات العامة")}
                </bdi>
              </p>
            ) : null}
            {reviewRecord?.kind === "payoutStatus" ? (
              <p>
                {copy("Current payout", "عملية الصرف الحالية")}: {label(reviewRecord.payout.status)}{" "}
                · {amount(reviewRecord.payout.currency, reviewRecord.payout.amount)}
              </p>
            ) : null}
            {reviewRecord?.kind === "channel" ? (
              <p>
                {copy("The original channel was read", "تمت قراءة القناة الأصلية")}:{" "}
                <bdi>{reviewRecord.target.channelId}</bdi> ·{" "}
                {formatNumber(reviewRecord.target.contracts.length)} {copy("contracts", "عقد")}
              </p>
            ) : null}
            {reviewRecord?.kind === "snapshot" && reviewCommand?.kind === "dispute" ? (
              <p>
                {copy("Current dispute", "النزاع الحالي")}:{" "}
                {reviewRecord.snapshot.disputes.find((row) => row.id === reviewCommand.base.id)
                  ? label(
                      reviewRecord.snapshot.disputes.find(
                        (row) => row.id === reviewCommand.base.id,
                      )!.status,
                    )
                  : copy(
                      "Not found in the latest 250; the outcome remains inconclusive.",
                      "غير موجود ضمن آخر ٢٥٠ نزاعًا؛ لا تزال النتيجة غير محسومة.",
                    )}
              </p>
            ) : null}
            {reviewRecord?.kind === "report" ? (
              <p>
                {copy("Original source report", "تقرير المصدر الأصلي")}:{" "}
                {reviewRecord.report ? (
                  <>
                    <bdi>{reviewRecord.report.sourceReportId}</bdi> ·{" "}
                    {formatNumber(reviewRecord.report.totalRows)}{" "}
                    {copy("rows recorded", "صفًا مسجلًا")}
                  </>
                ) : (
                  copy(
                    "Not found at this read; an interrupted request may still be pending. Keep the original reference.",
                    "غير موجود عند هذه القراءة؛ قد يكون الطلب المنقطع قيد التنفيذ. احتفظ بالمرجع الأصلي.",
                  )
                )}
              </p>
            ) : null}
            <div className={styles.actions}>
              <ActionButton disabled={busy || denied} onClick={() => void review()}>
                {copy("Read current records and my decisions", "قراءة السجلات الحالية وقراراتي")}
              </ActionButton>
              <ActionButton
                tone="secondary"
                disabled={!reviewed || busy}
                onClick={() => {
                  if (!reviewed || operation.current) return;
                  if (
                    !window.confirm(
                      copy(
                        "Missing records in this limited view do not prove an operation failed. Confirm you reviewed the current target and your decisions; a new action may add another entry.",
                        "غياب سجل من هذه النتائج المحدودة لا يثبت فشل العملية. أكّد مراجعتك للهدف الحالي وقراراتك؛ قد يضيف إجراء جديد قيدًا آخر.",
                      ),
                    )
                  )
                    return;
                  decisionLocked.current = false;
                  setLocked(false);
                  setReviewed(false);
                  setReviewCommand(null);
                  setReviewRecord(null);
                }}
              >
                {copy("I reviewed the records", "راجعت السجلات")}
              </ActionButton>
            </div>
          </StatusNotice>
        ) : null}
        {snapshot ? (
          <EditorTabs
            label={copy("Finance sections", "أقسام المالية")}
            value={tab}
            onChange={(id) => {
              setTab(id);
              if (id === "reconciliation" && !reportData) void readReports(appliedReportFilters);
            }}
            direction={ar ? "rtl" : "ltr"}
            tabs={[
              {
                id: "reconciliation",
                label: copy("Report reconciliation", "مطابقة التقارير"),
                content: (
                  <FinanceReconciliation
                    draft={reportDraft}
                    data={reportData}
                    detail={reportDetail}
                    filters={reportFilters}
                    applied={appliedReportFilters}
                    rowPage={reportRowPage}
                    disabled={disabled}
                    busy={busy}
                    onDraft={editReport}
                    onFilters={(value) =>
                      setReportFilters((previous) => ({ ...previous, ...value }))
                    }
                    onRead={(filters) => void readReports(filters)}
                    onSave={() => submit(() => financeReportCommand(reportDraft))}
                    onRowPage={setReportRowPage}
                    onInspect={(id) => {
                      if (operation.current) return;
                      setReportDetail(null);
                      void runRead(async (signal, session) => {
                        const next = await getFinanceReportDetail(id, session, signal);
                        if (!signal.aborted) {
                          setReportDetail(next);
                          setReportRowPage(1);
                        }
                      });
                    }}
                    onFile={(file) => {
                      if (operation.current) return;
                      if (file.size > 5000000) {
                        setNotice("invalid");
                        return;
                      }
                      dirty.current = true;
                      void runRead(async (signal) => {
                        const content = await file.text();
                        if (!signal.aborted) editReport({ payload: content, format: "CSV" });
                      });
                    }}
                  />
                ),
              },
              {
                id: "overview",
                label: copy("Overview and defaults", "الملخص والإعدادات"),
                content: (
                  <div className={styles.list}>
                    <MetricList
                      label={copy("Financial overview", "الملخص المالي")}
                      items={[
                        {
                          label: copy("Pending payouts", "عمليات الصرف المعلقة"),
                          value: formatNumber(snapshot.summary.pendingPayouts),
                        },
                        {
                          label: copy("Processing payouts", "عمليات الصرف قيد التنفيذ"),
                          value: formatNumber(snapshot.summary.processingPayouts),
                        },
                        {
                          label: copy("Open disputes", "النزاعات المفتوحة"),
                          value: formatNumber(snapshot.summary.openDisputes),
                        },
                      ]}
                    />
                    <FormSection
                      id="finance-section-6"
                      legend={copy("Pending amounts by currency", "المبالغ المعلقة حسب العملة")}
                    >
                      <div className={styles.actions}>
                        {snapshot.summary.pendingValue.length ? (
                          snapshot.summary.pendingValue.map((row) => (
                            <span key={row.currency}>{amount(row.currency, row.amount)}</span>
                          ))
                        ) : (
                          <p>{copy("No pending amounts", "لا توجد مبالغ معلقة")}</p>
                        )}
                      </div>
                    </FormSection>
                    <p>
                      {copy("External payment provider", "مزود الدفع الخارجي")}:{" "}
                      <bdi>{snapshot.summary.externalProvider.provider}</bdi> ·{" "}
                      {snapshot.summary.externalProvider.connected
                        ? copy("Connected", "متصل")
                        : copy("Not connected", "غير متصل")}{" "}
                      ·{" "}
                      {snapshot.summary.externalProvider.productionEnabled
                        ? copy("Production enabled", "مفعّل للإنتاج")
                        : copy("Production not enabled", "غير مفعّل للإنتاج")}
                    </p>
                    {settingsDraft ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submit(() => ({
                            kind: "settings",
                            input: {
                              defaultCreatorRevenueShareBps: financeBps(settingsDraft.share),
                              payoutThresholdMicros: thresholdMicros(settingsDraft.threshold),
                            },
                          }));
                        }}
                      >
                        <FormSection
                          id="finance-section-7"
                          legend={copy("Global revenue defaults", "الإعدادات الافتراضية للإيرادات")}
                        >
                          <fieldset disabled={disabled}>
                            <div className={styles.grid}>
                              <TextField
                                id="finance-default-share"
                                label={copy(
                                  "Default creator share (0–10000 basis points)",
                                  "حصة المنشئ الافتراضية (٠–١٠٠٠٠ نقطة أساس)",
                                )}
                                value={settingsDraft.share}
                                maxLength={5}
                                onChange={(event) => {
                                  const value = {
                                    ...settingsDraft,
                                    share: event.target.value,
                                    dirty: true,
                                  };
                                  dirty.current = true;
                                  settingsRef.current = value;
                                  setSettingsDraft(value);
                                }}
                              />
                              <TextField
                                id="finance-default-threshold"
                                label={copy(
                                  "Minimum payout amount (each currency)",
                                  "الحد الأدنى للصرف (لكل عملة)",
                                )}
                                value={settingsDraft.threshold}
                                maxLength={129}
                                onChange={(event) => {
                                  const value = {
                                    ...settingsDraft,
                                    threshold: event.target.value,
                                    dirty: true,
                                  };
                                  dirty.current = true;
                                  settingsRef.current = value;
                                  setSettingsDraft(value);
                                }}
                              />
                            </div>
                            <ActionButton type="submit">
                              {copy("Save defaults", "حفظ الإعدادات")}
                            </ActionButton>
                          </fieldset>
                        </FormSection>
                      </form>
                    ) : null}
                  </div>
                ),
              },
              {
                id: "channel",
                label: copy("Channel decisions", "قرارات القناة"),
                content: (
                  <div className={styles.list}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        setMatches([]);
                        void runRead(async (signal, session) => {
                          const rows = await searchFinanceTargets(query, session, signal);
                          if (!signal.aborted) setMatches(rows);
                        });
                      }}
                    >
                      <div className={styles.grid}>
                        <TextField
                          id="finance-channel-query"
                          label={copy("Channel name or handle", "اسم القناة أو معرّفها")}
                          value={query}
                          minLength={2}
                          maxLength={200}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                        <ActionButton type="submit" disabled={busy}>
                          {copy("Search channels", "البحث عن القنوات")}
                        </ActionButton>
                      </div>
                    </form>
                    <p>
                      {copy(
                        "Up to 25 matches. Narrow your search when needed; drafts are retained by channel.",
                        "حتى ٢٥ نتيجة. حدّد البحث عند الحاجة؛ تُحفظ المسودات لكل قناة.",
                      )}
                    </p>
                    <div className={styles.actions}>
                      {matches.map((channel) => (
                        <ActionButton
                          key={channel.id}
                          tone="secondary"
                          disabled={busy}
                          onClick={() => void selectChannel(channel)}
                        >
                          <span dir="auto">{channel.name}</span> <bdi>@{channel.handle}</bdi>
                        </ActionButton>
                      ))}
                    </div>
                    {channelForms}
                  </div>
                ),
              },
              {
                id: "payouts",
                label: copy("Payouts", "عمليات الصرف"),
                content: (
                  <div className={styles.list}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void readSnapshot({
                          ...applied,
                          payoutStatus: payoutFilter,
                          payoutPage: 1,
                        });
                      }}
                    >
                      <SelectField
                        id="finance-payout-filter"
                        label={copy("Payout status", "حالة الصرف")}
                        value={payoutFilter}
                        onChange={(event) => setPayoutFilter(event.target.value)}
                      >
                        <option value="">{copy("All statuses", "كل الحالات")}</option>
                        {options(financePayoutStates)}
                      </SelectField>
                      <ActionButton type="submit" disabled={busy}>
                        {copy("Apply payout filter", "تطبيق فلتر الصرف")}
                      </ActionButton>
                    </form>
                    {snapshot.payouts.items.map((row) => {
                      const value = payoutDrafts[row.id] ?? {
                        status: row.status,
                        reason: "",
                        resolution: "",
                        externalReference: row.externalReference ?? "",
                        failureReason: row.failureReason ?? "",
                        dirty: false,
                      };
                      return (
                        <article key={row.id} className={styles.record}>
                          <h2 dir="auto">{row.channel.name}</h2>
                          <div className={styles.actions}>
                            {amount(row.currency, row.amount)}
                            <DataBadge>{label(row.status)}</DataBadge>
                            <bdi>{row.provider}</bdi>
                          </div>
                          <p>
                            {formatDate(row.requestedAt)} · <bdi>{row.id}</bdi>
                          </p>
                          <Link href={href(`/admin/revenue/payouts/${row.id}`)}>
                            {copy(
                              "Payout details and provider workflow",
                              "تفاصيل الصرف وإجراءات المزود",
                            )}
                          </Link>
                          {row.providerTransfer ? (
                            <p>
                              {copy("Provider transfer", "تحويل المزود")}:{" "}
                              <span>{label(row.providerTransfer.state)}</span> ·{" "}
                              <bdi>
                                {row.providerTransfer.externalTransferId ??
                                  copy("No external reference", "بدون مرجع خارجي")}
                              </bdi>
                            </p>
                          ) : null}
                          {row.provider === "MANUAL" ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                submit(() => ({
                                  kind: "payoutStatus",
                                  base: row,
                                  input: {
                                    status: value.status as typeof row.status,
                                    reason: value.reason,
                                    externalReference: value.externalReference.trim() || null,
                                    failureReason: value.failureReason.trim() || null,
                                  },
                                }));
                              }}
                            >
                              <fieldset disabled={disabled}>
                                <div className={styles.grid}>
                                  <SelectField
                                    id={`finance-payout-status-${row.id}`}
                                    label={copy("New status", "الحالة الجديدة")}
                                    value={value.status}
                                    onChange={(event) =>
                                      editDecision(
                                        "payout",
                                        row.id,
                                        value,
                                        "status",
                                        event.target.value,
                                      )
                                    }
                                  >
                                    {!financeManualPayoutChoices(row.status).includes(
                                      value.status as typeof row.status,
                                    ) ? (
                                      <option value={value.status} disabled>
                                        {label(value.status)} ·{" "}
                                        {copy(
                                          "Retained draft; transition unavailable",
                                          "مسودة محفوظة؛ الانتقال غير متاح",
                                        )}
                                      </option>
                                    ) : null}
                                    {options(financeManualPayoutChoices(row.status))}
                                  </SelectField>
                                  <TextField
                                    id={`finance-payout-ref-${row.id}`}
                                    label={copy(
                                      "External reference (optional)",
                                      "مرجع خارجي (اختياري)",
                                    )}
                                    value={value.externalReference}
                                    maxLength={255}
                                    onChange={(event) =>
                                      editDecision(
                                        "payout",
                                        row.id,
                                        value,
                                        "externalReference",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <TextField
                                    id={`finance-payout-failure-${row.id}`}
                                    label={copy("Failure reason (optional)", "سبب الفشل (اختياري)")}
                                    value={value.failureReason}
                                    maxLength={1000}
                                    onChange={(event) =>
                                      editDecision(
                                        "payout",
                                        row.id,
                                        value,
                                        "failureReason",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <TextField
                                    id={`finance-payout-reason-${row.id}`}
                                    label={copy(
                                      "Decision reason (8–500 characters)",
                                      "سبب القرار (٨–٥٠٠ حرف)",
                                    )}
                                    value={value.reason}
                                    maxLength={500}
                                    onChange={(event) =>
                                      editDecision(
                                        "payout",
                                        row.id,
                                        value,
                                        "reason",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <ActionButton type="submit">
                                  {copy("Record payout decision", "تسجيل قرار الصرف")}
                                </ActionButton>
                              </fieldset>
                            </form>
                          ) : (
                            <p>
                              {copy(
                                "Provider-managed payouts use the protected provider workflow.",
                                "عمليات الصرف التي يديرها المزود تستخدم إجراءاته المحمية.",
                              )}
                            </p>
                          )}
                        </article>
                      );
                    })}
                    <FinancePager
                      page={applied.payoutPage}
                      pages={snapshot.payouts.pagination.pages}
                      name={copy("Payout pages", "صفحات الصرف")}
                      busy={busy}
                      previous={copy("Previous", "السابق")}
                      next={copy("Next", "التالي")}
                      summary={copy(
                        `Page ${formatNumber(applied.payoutPage)} of ${formatNumber(snapshot.payouts.pagination.pages)} · ${formatNumber(snapshot.payouts.pagination.total)} records`,
                        `صفحة ${formatNumber(applied.payoutPage)} من ${formatNumber(snapshot.payouts.pagination.pages)} · ${formatNumber(snapshot.payouts.pagination.total)} سجل`,
                      )}
                      onChange={(page) => void readSnapshot({ ...applied, payoutPage: page })}
                    />
                  </div>
                ),
              },
              {
                id: "disputes",
                label: copy("Disputes", "النزاعات"),
                content: (
                  <div className={styles.list}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        setDisputePage(1);
                        void readSnapshot({ ...applied, disputeStatus: disputeFilter });
                      }}
                    >
                      <SelectField
                        id="finance-dispute-filter"
                        label={copy("Dispute status", "حالة النزاع")}
                        value={disputeFilter}
                        onChange={(event) => setDisputeFilter(event.target.value)}
                      >
                        <option value="">{copy("All statuses", "كل الحالات")}</option>
                        {options(financeDisputeStates)}
                      </SelectField>
                      <ActionButton type="submit" disabled={busy}>
                        {copy("Apply dispute filter", "تطبيق فلتر النزاعات")}
                      </ActionButton>
                    </form>
                    <p>
                      {copy(
                        "Latest 250 matching disputes; all returned records are available below. This is not a complete historical export.",
                        "آخر ٢٥٠ نزاعًا مطابقًا؛ كل السجلات المسترجعة متاحة أدناه. ليست هذه نسخة كاملة من الأرشيف.",
                      )}
                    </p>
                    {snapshot.disputes
                      .slice((disputePage - 1) * 20, disputePage * 20)
                      .map((row) => {
                        const value = disputeDrafts[row.id] ?? {
                          status: row.status,
                          reason: "",
                          resolution: row.resolution ?? "",
                          externalReference: "",
                          failureReason: "",
                          dirty: false,
                        };
                        return (
                          <article className={styles.record} key={row.id}>
                            <h2 dir="auto">{row.channelName}</h2>
                            <div className={styles.actions}>
                              <DataBadge>{label(row.status)}</DataBadge>
                              <span>{formatDate(row.createdAt)}</span>
                            </div>
                            <p dir="auto">{row.message}</p>
                            <p>
                              <bdi>{row.creatorEmail}</bdi> · <bdi>{row.id}</bdi>
                            </p>
                            {row.payoutId ? (
                              <Link href={href(`/admin/revenue/payouts/${row.payoutId}`)}>
                                {copy("Related payout", "عملية الصرف المرتبطة")}
                              </Link>
                            ) : null}
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                submit(() => ({
                                  kind: "dispute",
                                  base: row,
                                  input: {
                                    status: value.status as typeof row.status,
                                    resolution: value.resolution.trim() || null,
                                    reason: value.reason,
                                  },
                                }));
                              }}
                            >
                              <fieldset disabled={disabled}>
                                <SelectField
                                  id={`finance-dispute-status-${row.id}`}
                                  label={copy("New status", "الحالة الجديدة")}
                                  value={value.status}
                                  onChange={(event) =>
                                    editDecision(
                                      "dispute",
                                      row.id,
                                      value,
                                      "status",
                                      event.target.value,
                                    )
                                  }
                                >
                                  {options(financeDisputeStates)}
                                </SelectField>
                                <TextAreaField
                                  id={`finance-dispute-resolution-${row.id}`}
                                  label={copy(
                                    "Resolution (required for resolved or rejected)",
                                    "القرار (مطلوب للحل أو الرفض)",
                                  )}
                                  value={value.resolution}
                                  maxLength={5000}
                                  onChange={(event) =>
                                    editDecision(
                                      "dispute",
                                      row.id,
                                      value,
                                      "resolution",
                                      event.target.value,
                                    )
                                  }
                                />
                                <TextField
                                  id={`finance-dispute-reason-${row.id}`}
                                  label={copy(
                                    "Decision reason (8–500 characters)",
                                    "سبب القرار (٨–٥٠٠ حرف)",
                                  )}
                                  value={value.reason}
                                  maxLength={500}
                                  onChange={(event) =>
                                    editDecision(
                                      "dispute",
                                      row.id,
                                      value,
                                      "reason",
                                      event.target.value,
                                    )
                                  }
                                />
                                <ActionButton type="submit">
                                  {copy("Record dispute decision", "تسجيل قرار النزاع")}
                                </ActionButton>
                              </fieldset>
                            </form>
                          </article>
                        );
                      })}
                    <FinancePager
                      page={disputePage}
                      pages={Math.max(1, Math.ceil(snapshot.disputes.length / 20))}
                      name={copy("Dispute pages", "صفحات النزاعات")}
                      busy={busy}
                      previous={copy("Previous", "السابق")}
                      next={copy("Next", "التالي")}
                      summary={copy(
                        `Page ${formatNumber(disputePage)} of ${formatNumber(Math.max(1, Math.ceil(snapshot.disputes.length / 20)))} · ${formatNumber(snapshot.disputes.length)} records`,
                        `صفحة ${formatNumber(disputePage)} من ${formatNumber(Math.max(1, Math.ceil(snapshot.disputes.length / 20)))} · ${formatNumber(snapshot.disputes.length)} سجل`,
                      )}
                      onChange={setDisputePage}
                    />
                  </div>
                ),
              },
              {
                id: "ledger",
                label: copy("Revenue ledger", "دفتر الإيرادات"),
                content: (
                  <div className={styles.list}>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void readSnapshot({
                          ...applied,
                          ledgerChannelId: ledgerFilter.trim(),
                          ledgerPage: 1,
                        });
                      }}
                    >
                      <TextField
                        id="finance-ledger-channel"
                        label={copy("Channel ID (optional)", "معرّف القناة (اختياري)")}
                        value={ledgerFilter}
                        maxLength={36}
                        onChange={(event) => setLedgerFilter(event.target.value)}
                      />
                      <ActionButton type="submit" disabled={busy}>
                        {copy("Apply ledger filter", "تطبيق فلتر القيود")}
                      </ActionButton>
                    </form>
                    {snapshot.ledger.items.map((row) => (
                      <article key={row.id} className={styles.record}>
                        <h2 dir="auto">{row.channel.name}</h2>
                        <div className={styles.actions}>
                          {amount(row.currency, row.amount)}
                          <DataBadge>{label(row.type)}</DataBadge>
                          <DataBadge>{label(row.state)}</DataBadge>
                        </div>
                        <p>
                          {formatDate(row.occurredAt)} · <bdi>{row.id}</bdi>
                        </p>
                        <Disclosure summary={copy("Entry details", "تفاصيل القيد")}>
                          <dl className={styles.facts}>
                            <div>
                              <dt>{copy("Gross amount", "المبلغ الإجمالي")}</dt>
                              <dd>
                                {row.grossAmount === null
                                  ? copy("Not recorded", "غير مسجل")
                                  : amount(row.currency, row.grossAmount)}
                              </dd>
                            </div>
                            <div>
                              <dt>{copy("Advertising source", "مصدر الإعلان")}</dt>
                              <dd dir="auto">{row.adSource ?? copy("Not recorded", "غير مسجل")}</dd>
                            </div>
                            <div>
                              <dt>{copy("Period", "الفترة")}</dt>
                              <dd>
                                {row.periodStart ? formatDate(row.periodStart) : "—"} ·{" "}
                                {row.periodEnd ? formatDate(row.periodEnd) : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>{copy("Video", "الفيديو")}</dt>
                              <dd dir="auto">{row.video?.title ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>{copy("Campaign", "الحملة")}</dt>
                              <dd dir="auto">{row.campaign?.name ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>{copy("Memo", "الملاحظة")}</dt>
                              <dd dir="auto">{row.memo ?? "—"}</dd>
                            </div>
                          </dl>
                          {row.payout ? (
                            <Link href={href(`/admin/revenue/payouts/${row.payout.id}`)}>
                              {copy("Related payout", "عملية الصرف المرتبطة")} ·{" "}
                              {label(row.payout.status)}
                            </Link>
                          ) : null}
                        </Disclosure>
                      </article>
                    ))}
                    <FinancePager
                      page={applied.ledgerPage}
                      pages={snapshot.ledger.pagination.pages}
                      name={copy("Ledger pages", "صفحات القيود")}
                      busy={busy}
                      previous={copy("Previous", "السابق")}
                      next={copy("Next", "التالي")}
                      summary={copy(
                        `Page ${formatNumber(applied.ledgerPage)} of ${formatNumber(snapshot.ledger.pagination.pages)} · ${formatNumber(snapshot.ledger.pagination.total)} records`,
                        `صفحة ${formatNumber(applied.ledgerPage)} من ${formatNumber(snapshot.ledger.pagination.pages)} · ${formatNumber(snapshot.ledger.pagination.total)} سجل`,
                      )}
                      onChange={(page) => void readSnapshot({ ...applied, ledgerPage: page })}
                    />
                  </div>
                ),
              },
              {
                id: "actions",
                label: copy("My recent decisions", "قراراتي الأخيرة"),
                content: (
                  <div className={styles.list}>
                    <p>
                      {copy(
                        "Latest 100 financial decisions by this account. Missing entries do not prove a write failed.",
                        "آخر ١٠٠ قرار مالي لهذا الحساب. غياب قيد لا يثبت فشل عملية الحفظ.",
                      )}
                    </p>
                    <ActionButton
                      disabled={busy}
                      onClick={() =>
                        void runRead(async (signal, session) => {
                          const next = await getFinanceActions(session, signal);
                          if (!signal.aborted) {
                            setActions(next);
                            setActionPage(1);
                          }
                        })
                      }
                    >
                      {copy("Read my decisions", "قراءة قراراتي")}
                    </ActionButton>
                    {actions ? (
                      <>
                        {actions.slice((actionPage - 1) * 20, actionPage * 20).map((row) => (
                          <article key={row.id} className={styles.record}>
                            <h2>{label(row.action)}</h2>
                            <p>
                              {formatDate(row.createdAt)} · <bdi>{row.entityId}</bdi>
                            </p>
                            <p dir="auto">{row.reason}</p>
                            <Disclosure summary={copy("Decision details", "تفاصيل القرار")}>
                              <dl className={styles.facts}>
                                {Object.entries(row.metadata).map(([key, value]) => (
                                  <div key={key}>
                                    <dt>{label(key)}</dt>
                                    <dd dir="auto">
                                      {value === null
                                        ? "—"
                                        : typeof value === "boolean"
                                          ? value
                                            ? copy("Yes", "نعم")
                                            : copy("No", "لا")
                                          : typeof value === "number"
                                            ? formatNumber(value)
                                            : label(String(value))}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </Disclosure>
                          </article>
                        ))}
                        <FinancePager
                          page={actionPage}
                          pages={Math.max(1, Math.ceil(actions.length / 20))}
                          name={copy("Recent decisions", "القرارات الأخيرة")}
                          busy={busy}
                          previous={copy("Previous", "السابق")}
                          next={copy("Next", "التالي")}
                          summary={copy(
                            `Page ${formatNumber(actionPage)} of ${formatNumber(Math.max(1, Math.ceil(actions.length / 20)))} · ${formatNumber(actions.length)} records`,
                            `صفحة ${formatNumber(actionPage)} من ${formatNumber(Math.max(1, Math.ceil(actions.length / 20)))} · ${formatNumber(actions.length)} سجل`,
                          )}
                          onChange={setActionPage}
                        />
                      </>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  );
}
