"use client";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { canReadOperations } from "@/lib/admin-operator";
import { getWarehouseStatus } from "@/lib/admin-warehouse";
import { useAdminAccess } from "./admin-access";
import { OperatorSnapshot, OperatorTable } from "./operator-snapshot";

const labels: Record<string, [string, string]> = {
  analytics_facts: ["Analytics", "التحليلات"],
  content_dimensions: ["Content", "المحتوى"],
  channel_dimensions: ["Channels", "القنوات"],
  ad_facts: ["Advertising", "الإعلانات"],
  revenue_facts: ["Revenue", "الإيرادات"],
};

export function AdminWarehouseStatus() {
  const { session } = useAdminAccess();
  const { locale, formatDate, formatNumber } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const date = (value: string | null) =>
    value
      ? formatDate(value, { dateStyle: "medium", timeStyle: "medium" })
      : text("Not recorded", "غير مسجل");
  return (
    <OperatorSnapshot
      title={text("Data export status", "حالة تصدير البيانات")}
      allowed={canReadOperations(session?.roles ?? [])}
      load={getWarehouseStatus}
    >
      {(data) => (
        <>
          <section className={styles.operatorSection} aria-labelledby="export-configuration">
            <h2 id="export-configuration">
              {data.configured
                ? text("Export connector configured", "موصل التصدير مهيأ")
                : text("Export connector not configured", "موصل التصدير غير مهيأ")}
            </h2>
            <p>
              {text(
                "Configuration does not confirm that a worker is running or that delivery is healthy. No independent worker heartbeat is available.",
                "التهيئة لا تؤكد تشغيل العامل أو سلامة التسليم. لا تتوفر إشارة حياة مستقلة للعامل.",
              )}
            </p>
            {!data.configured ? (
              <p>
                {text(
                  "Exports are disabled with the current connector. Historical checkpoints may still be shown below.",
                  "التصدير معطل مع الموصل الحالي. قد تظهر أدناه نقاط تقدم تاريخية.",
                )}
              </p>
            ) : null}
            <dl className={styles.operatorFacts}>
              <div>
                <dt>{text("Maximum records per batch", "الحد الأقصى للسجلات في الدفعة")}</dt>
                <dd>{formatNumber(data.pageSize)}</dd>
              </div>
              <div>
                <dt>{text("Configured interval (minutes)", "الفاصل المهيأ (دقائق)")}</dt>
                <dd>{formatNumber(data.intervalMs / 60_000, { maximumFractionDigits: 2 })}</dd>
              </div>
            </dl>
          </section>
          <section className={styles.operatorSection} aria-labelledby="export-checkpoints">
            <h2 id="export-checkpoints">{text("Delivery checkpoints", "نقاط تقدم التسليم")}</h2>
            <p className={styles.muted}>
              {text(
                "A checkpoint advances only after a batch is accepted. No new records may mean no change; these timestamps do not establish a delay or a failure. Cursor time tracks source ordering, not delivery time.",
                "تتقدم نقطة التسليم فقط بعد قبول الدفعة. قد لا تتغير عند غياب سجلات جديدة؛ هذه الأوقات لا تثبت تأخرًا أو فشلًا. وقت المؤشر يتبع ترتيب المصدر وليس وقت التسليم.",
              )}
            </p>
            {!data.datasets.some((row) => row.lastSucceededAt) ? (
              <p>
                {text(
                  "No successful export batch has been recorded for the current dataset versions.",
                  "لم تسجل دفعة تصدير ناجحة لإصدارات مجموعات البيانات الحالية.",
                )}
              </p>
            ) : null}
            <OperatorTable
              label={text("Dataset delivery", "تسليم مجموعات البيانات")}
              headings={[
                text("Dataset", "مجموعة البيانات"),
                text("Schema version", "إصدار المخطط"),
                text("Last accepted batch", "آخر دفعة مقبولة"),
                text("Source cursor time", "وقت مؤشر المصدر"),
              ]}
            >
              {data.datasets.map((row) => (
                <tr key={`${row.dataset}:${row.schemaVersion}`}>
                  <th scope="row">
                    {labels[row.dataset]?.[locale === "ar" ? 1 : 0] ?? row.dataset}
                  </th>
                  <td>{formatNumber(row.schemaVersion)}</td>
                  <td>{date(row.lastSucceededAt)}</td>
                  <td>{date(row.cursorAt)}</td>
                </tr>
              ))}
            </OperatorTable>
          </section>
        </>
      )}
    </OperatorSnapshot>
  );
}
