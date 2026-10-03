"use client";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  FormSection,
  TextField,
  SelectField,
  TextAreaField,
  StatusNotice,
  MetricList,
  DataBadge,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import { exactFinanceMoney } from "@/lib/creator-finance";
import {
  financeReportInput,
  financeReconciliationStates,
  type FinanceCommand,
  type RevenueReconciliationImportInput,
  type getFinanceReconciliation,
  type getFinanceReportDetail,
} from "@/lib/admin-finance-workspace";
import styles from "./admin-finance.module.css";
export type FinanceReportDraft = {
  source: string;
  sourceReportId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  state: "ESTIMATED" | "FINAL";
  format: "CSV" | "STRUCTURED";
  payload: string;
  dirty: boolean;
};
export type FinanceReportFilters = { source: string; status: string; page: number };
export const emptyFinanceReportDraft: FinanceReportDraft = {
  source: "",
  sourceReportId: "",
  periodStart: "",
  periodEnd: "",
  currency: "",
  state: "ESTIMATED",
  format: "CSV",
  payload: "",
  dirty: false,
};
export function financeReportCommand(draft: FinanceReportDraft): FinanceCommand {
  const base = {
    source: draft.source.trim(),
    sourceReportId: draft.sourceReportId.trim(),
    periodStart: new Date(draft.periodStart).toISOString(),
    periodEnd: new Date(draft.periodEnd).toISOString(),
    currency: draft.currency.trim().toUpperCase(),
    state: draft.state,
  };
  const input: RevenueReconciliationImportInput =
    draft.format === "CSV"
      ? { ...base, format: "CSV", csv: draft.payload }
      : { ...base, format: "STRUCTURED", rows: JSON.parse(draft.payload) };
  return { kind: "reportImport", input: financeReportInput(input) };
}
export function FinanceReconciliation({
  draft,
  data,
  detail,
  filters,
  applied,
  rowPage,
  disabled,
  busy,
  onDraft,
  onFilters,
  onRead,
  onSave,
  onInspect,
  onFile,
  onRowPage,
}: {
  draft: FinanceReportDraft;
  data: Awaited<ReturnType<typeof getFinanceReconciliation>> | null;
  detail: Awaited<ReturnType<typeof getFinanceReportDetail>> | null;
  filters: FinanceReportFilters;
  applied: FinanceReportFilters;
  rowPage: number;
  disabled: boolean;
  busy: boolean;
  onDraft: (value: Partial<FinanceReportDraft>) => void;
  onFilters: (value: Partial<FinanceReportFilters>) => void;
  onRead: (value: FinanceReportFilters) => void;
  onSave: () => void;
  onInspect: (id: string) => void;
  onFile: (file: File) => void;
  onRowPage: (page: number) => void;
}) {
  const { locale, formatNumber, formatDate } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const state = (value: string) =>
    ({
      MATCHED: copy("Matched", "مطابق"),
      UNMATCHED: copy("Unmatched", "غير مطابق"),
      DUPLICATE: copy("Duplicate", "مكرر"),
      CORRECTED: copy("Corrected", "مصَحَّح"),
      FINALIZED: copy("Finalized", "نهائي"),
      ANOMALOUS: copy("Needs review", "يحتاج مراجعة"),
      ESTIMATED: copy("Estimated", "تقديري"),
      FINAL: copy("Final", "نهائي"),
    })[value] ?? value;
  const money = (code: string, value: string) => (
    <bdi className={styles.money}>{exactFinanceMoney(code, value)}</bdi>
  );
  const field = (
    key: "source" | "sourceReportId" | "periodStart" | "periodEnd" | "currency",
    label: string,
    maxLength: number,
    type = "text",
  ) => (
    <TextField
      id={`finance-report-${key}`}
      label={label}
      value={draft[key]}
      maxLength={maxLength}
      type={type}
      onChange={(event) => onDraft({ [key]: event.target.value })}
    />
  );
  return (
    <div className={styles.list}>
      <h2>{copy("Revenue report reconciliation", "مطابقة تقارير الإيرادات")}</h2>
      <p>
        {copy(
          "Import a source report and review how each row maps to revenue records. Keep the same source and report reference when reviewing an interrupted import.",
          "استورد تقرير المصدر وراجع مطابقة كل صف مع قيود الإيرادات. احتفظ بالمصدر ومرجع التقرير نفسيهما عند مراجعة استيراد انقطع ردّه.",
        )}
      </p>
      {!data ? (
        <StatusNotice title={copy("Report records unavailable", "سجلات التقارير غير متاحة")}>
          <ActionButton disabled={busy} onClick={() => onRead(applied)}>
            {copy("Read report records", "قراءة سجلات التقارير")}
          </ActionButton>
        </StatusNotice>
      ) : (
        <>
          <p>
            {data.capabilities.automaticProviderSyncConfigured
              ? copy(
                  "Automatic provider sync is configured.",
                  "المزامنة التلقائية مع المزود مُعدّة.",
                )
              : copy(
                  "Reports are imported explicitly; automatic provider sync is not configured.",
                  "تُستورد التقارير يدويًا؛ المزامنة التلقائية مع المزود غير مُعدّة.",
                )}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <FormSection
              id="finance-report-import"
              legend={copy("Import a source report", "استيراد تقرير المصدر")}
            >
              <fieldset disabled={disabled || !data}>
                <div className={styles.grid}>
                  {field("source", copy("Source", "المصدر"), 80)}
                  {field(
                    "sourceReportId",
                    copy("Source report reference", "مرجع تقرير المصدر"),
                    160,
                  )}
                  {field(
                    "periodStart",
                    copy("Period start", "بداية الفترة"),
                    500,
                    "datetime-local",
                  )}
                  {field("periodEnd", copy("Period end", "نهاية الفترة"), 500, "datetime-local")}
                  {field("currency", copy("Currency", "العملة"), 3)}
                  <SelectField
                    id="finance-report-state"
                    label={copy("Revenue state", "حالة الإيراد")}
                    value={draft.state}
                    onChange={(event) =>
                      onDraft({ state: event.target.value as FinanceReportDraft["state"] })
                    }
                  >
                    {["ESTIMATED", "FINAL"].map((value) => (
                      <option key={value} value={value}>
                        {state(value)}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    id="finance-report-format"
                    label={copy("Report format", "صيغة التقرير")}
                    value={draft.format}
                    onChange={(event) =>
                      onDraft({ format: event.target.value as FinanceReportDraft["format"] })
                    }
                  >
                    {data.capabilities.supportedImportFormats.map((value) => (
                      <option key={value} value={value}>
                        {value === "CSV" ? "CSV" : copy("Structured JSON", "JSON منظم")}
                      </option>
                    ))}
                  </SelectField>
                </div>
                {draft.format === "CSV" ? (
                  <TextField
                    id="finance-report-file"
                    label={copy("CSV file (up to 5 MB)", "ملف CSV (حتى ٥ ميجابايت)")}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) onFile(file);
                    }}
                  />
                ) : null}
                <TextAreaField
                  id="finance-report-content"
                  label={
                    draft.format === "CSV"
                      ? copy("CSV content", "محتوى CSV")
                      : copy("Report rows as a JSON array", "صفوف التقرير كمصفوفة JSON")
                  }
                  value={draft.payload}
                  maxLength={5000000}
                  rows={8}
                  onChange={(event) => onDraft({ payload: event.target.value })}
                />
                <p>
                  {copy("Required CSV headers", "عناوين CSV المطلوبة")}:{" "}
                  <bdi>{data.capabilities.csvColumns.required.join(", ")}</bdi>
                </p>
                <p>
                  {copy("Optional CSV headers", "عناوين CSV الاختيارية")}:{" "}
                  <bdi>{data.capabilities.csvColumns.optional.join(", ")}</bdi>
                </p>
                <p>
                  {copy("Maximum rows", "الحد الأقصى للصفوف")}:{" "}
                  {formatNumber(data.capabilities.maxRows)}
                </p>
                <ActionButton type="submit">
                  {copy("Reconcile report", "مطابقة التقرير")}
                </ActionButton>
              </fieldset>
            </FormSection>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onRead({ ...filters, page: 1 });
            }}
          >
            <div className={styles.grid}>
              <TextField
                id="finance-report-filter-source"
                label={copy("Exact source (optional)", "المصدر المطابق (اختياري)")}
                value={filters.source}
                maxLength={80}
                onChange={(event) => onFilters({ source: event.target.value })}
              />
              <SelectField
                id="finance-report-filter-status"
                label={copy("Reports containing rows with status", "تقارير تتضمن صفوفًا بالحالة")}
                value={filters.status}
                onChange={(event) => onFilters({ status: event.target.value })}
              >
                <option value="">{copy("All statuses", "كل الحالات")}</option>
                {financeReconciliationStates.map((value) => (
                  <option key={value} value={value}>
                    {state(value)}
                  </option>
                ))}
              </SelectField>
            </div>
            <ActionButton type="submit" disabled={busy}>
              {copy("Apply report filters", "تطبيق فلاتر التقارير")}
            </ActionButton>
          </form>
          <div className={styles.list}>
            {data.reports.items.map((report) => (
              <article key={report.id} className={styles.record}>
                <h3 dir="auto">
                  {report.source} · <bdi>{report.sourceReportId}</bdi>
                </h3>
                <p>
                  {formatDate(report.periodStart)} · {formatDate(report.periodEnd)} ·{" "}
                  <bdi>{report.currency}</bdi> · {state(report.state)}
                </p>
                <MetricList
                  label={copy("Report counts", "أعداد التقرير")}
                  items={[
                    {
                      label: copy("Total rows", "إجمالي الصفوف"),
                      value: formatNumber(report.totalRows),
                    },
                    { label: state("MATCHED"), value: formatNumber(report.matchedRows) },
                    { label: state("UNMATCHED"), value: formatNumber(report.unmatchedRows) },
                    { label: state("DUPLICATE"), value: formatNumber(report.duplicateRows) },
                    { label: state("CORRECTED"), value: formatNumber(report.correctedRows) },
                    { label: state("FINALIZED"), value: formatNumber(report.finalizedRows) },
                    { label: state("ANOMALOUS"), value: formatNumber(report.anomalousRows) },
                  ]}
                />
                <ActionButton tone="secondary" disabled={busy} onClick={() => onInspect(report.id)}>
                  {copy("Inspect report rows", "فحص صفوف التقرير")}
                </ActionButton>
              </article>
            ))}
          </div>
          <PageControls
            label={copy("Report pages", "صفحات التقارير")}
            summary={copy(
              `Page ${formatNumber(applied.page)} of ${formatNumber(data.reports.pagination.pages)} · ${formatNumber(data.reports.pagination.total)} reports`,
              `صفحة ${formatNumber(applied.page)} من ${formatNumber(data.reports.pagination.pages)} · ${formatNumber(data.reports.pagination.total)} تقرير`,
            )}
            previousLabel={copy("Previous", "السابق")}
            nextLabel={copy("Next", "التالي")}
            hasPrevious={!busy && applied.page > 1}
            hasNext={!busy && applied.page < data.reports.pagination.pages}
            onPrevious={() => onRead({ ...applied, page: applied.page - 1 })}
            onNext={() => onRead({ ...applied, page: applied.page + 1 })}
          />
        </>
      )}
      {detail ? (
        <div className={styles.list}>
          <h3 dir="auto">
            {copy("Inspected report", "التقرير الجاري فحصه")}: {detail.report.source} ·{" "}
            <bdi>{detail.report.sourceReportId}</bdi>
          </h3>
          {detail.rows.slice((rowPage - 1) * 20, rowPage * 20).map((row) => (
            <article key={row.id} className={styles.record}>
              <div className={styles.actions}>
                <bdi>{row.externalRowId}</bdi>
                <DataBadge>{state(row.reconciliationStatus)}</DataBadge>
                {money(row.currency, row.grossAmount)}
              </div>
              <p>
                {copy("Creator amount", "مبلغ المنشئ")}:{" "}
                {row.creatorAmount === null
                  ? copy("Not attributed", "غير منسوب")
                  : money(row.currency, row.creatorAmount)}
              </p>
              <p dir="auto">{row.reason}</p>
              <Disclosure summary={copy("Row details", "تفاصيل الصف")}>
                <dl className={styles.facts}>
                  {[
                    [copy("Channel reference", "مرجع القناة"), row.channelRef],
                    [copy("Video reference", "مرجع الفيديو"), row.videoRef],
                    [copy("Content reference", "مرجع المحتوى"), row.contentRef],
                    [copy("Channel ID", "معرّف القناة"), row.channelId],
                    [copy("Video ID", "معرّف الفيديو"), row.videoId],
                    [copy("Revenue ledger entry", "قيد دفتر الإيرادات"), row.ledgerEntryId],
                    [copy("Previous row", "الصف السابق"), row.priorRowId],
                    [copy("Memo", "الملاحظة"), row.memo],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd dir="auto">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            </article>
          ))}
          <PageControls
            label={copy("Report row pages", "صفحات صفوف التقرير")}
            summary={copy(
              `Page ${formatNumber(rowPage)} of ${formatNumber(Math.max(1, Math.ceil(detail.rows.length / 20)))} · ${formatNumber(detail.rows.length)} rows`,
              `صفحة ${formatNumber(rowPage)} من ${formatNumber(Math.max(1, Math.ceil(detail.rows.length / 20)))} · ${formatNumber(detail.rows.length)} صف`,
            )}
            previousLabel={copy("Previous", "السابق")}
            nextLabel={copy("Next", "التالي")}
            hasPrevious={!busy && rowPage > 1}
            hasNext={!busy && rowPage * 20 < detail.rows.length}
            onPrevious={() => onRowPage(rowPage - 1)}
            onNext={() => onRowPage(rowPage + 1)}
          />
        </div>
      ) : null}
    </div>
  );
}
