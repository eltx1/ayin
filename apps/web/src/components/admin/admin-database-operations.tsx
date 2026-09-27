"use client";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { canReadDatabaseOperations, getDatabaseOperations } from "@/lib/admin-operator";
import { useAdminAccess } from "./admin-access";
import { OperatorSnapshot, OperatorTable } from "./operator-snapshot";

export function AdminDatabaseOperations() {
  const { session } = useAdminAccess();
  const { locale, formatNumber } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  return (
    <OperatorSnapshot
      title={text("PostgreSQL operations", "عمليات PostgreSQL")}
      allowed={canReadDatabaseOperations(session?.roles ?? [])}
      load={getDatabaseOperations}
    >
      {(data) => (
        <>
          <p className={styles.muted}>
            {text(
              "Connection counts cover the current database and database user. The server limit is shared across databases.",
              "أعداد الاتصالات تخص قاعدة البيانات ومستخدمها الحاليين. حد الخادم مشترك بين قواعد البيانات.",
            )}
          </p>
          <section
            aria-label={text("Database connections", "اتصالات قاعدة البيانات")}
            className={styles.metrics}
          >
            {[
              [text("Connections", "الاتصالات"), data.server.totalConnections],
              [text("Active", "النشطة"), data.server.activeConnections],
              [text("Idle", "الخاملة"), data.server.idleConnections],
              [
                text("Idle in transaction", "الخاملة داخل معاملة"),
                data.server.idleInTransactionConnections,
              ],
            ].map(([label, value]) => (
              <article className={styles.metric} key={label}>
                <span className={styles.muted}>{label}</span>
                <strong>{formatNumber(Number(value))}</strong>
              </article>
            ))}
          </section>
          <dl className={styles.operatorFacts}>
            <div>
              <dt>{text("Server connection limit", "حد اتصالات الخادم")}</dt>
              <dd>
                {data.server.maxConnections === null
                  ? text("Unavailable", "غير متاح")
                  : formatNumber(data.server.maxConnections)}
              </dd>
            </div>
            <div>
              <dt>{text("Application pool min / max", "حدود مجمع اتصالات التطبيق")}</dt>
              <dd>
                {formatNumber(data.pool.min)} / {formatNumber(data.pool.max)}
              </dd>
            </div>
            <div>
              <dt>{text("Application", "التطبيق")}</dt>
              <dd>
                <bdi>{data.pool.applicationName}</bdi>
              </dd>
            </div>
          </dl>
          <section className={styles.operatorSection} aria-labelledby="db-apps-title">
            <h2 id="db-apps-title">
              {text("Connections by application", "الاتصالات حسب التطبيق")}
            </h2>
            {data.server.byApplication.length ? (
              <OperatorTable
                label={text("Application connections", "اتصالات التطبيقات")}
                headings={[
                  text("Application", "التطبيق"),
                  text("Connections", "الاتصالات"),
                  text("Active", "النشطة"),
                ]}
              >
                {data.server.byApplication.map((app) => (
                  <tr key={app.applicationName}>
                    <th scope="row">
                      <bdi>{app.applicationName}</bdi>
                    </th>
                    <td>{formatNumber(app.connections)}</td>
                    <td>{formatNumber(app.active)}</td>
                  </tr>
                ))}
              </OperatorTable>
            ) : (
              <p>
                {text(
                  "No application connection rows are available.",
                  "لا تتوفر بيانات اتصالات التطبيقات.",
                )}
              </p>
            )}
          </section>
          <section className={styles.operatorSection} aria-labelledby="db-statements-title">
            <h2 id="db-statements-title">{text("Statement timings", "أزمنة الاستعلامات")}</h2>
            <p className={styles.muted}>
              {text(
                "Up to 20 statements, ranked by total execution time. Only query identifiers and aggregate metrics are exposed; SQL text is omitted.",
                "حتى 20 استعلامًا مرتبة حسب إجمالي وقت التنفيذ. تُعرض المعرّفات والمقاييس المجمعة فقط دون نصوص SQL.",
              )}
            </p>
            {data.slowStatements.available && data.slowStatements.rows.length ? (
              <OperatorTable
                label={text("Statement execution metrics", "مقاييس تنفيذ الاستعلامات")}
                headings={[
                  text("Query reference", "مرجع الاستعلام"),
                  text("Calls", "مرات التنفيذ"),
                  text("Total ms", "الإجمالي بالمللي ثانية"),
                  text("Mean ms", "المتوسط بالمللي ثانية"),
                  text("Rows", "الصفوف"),
                ]}
              >
                {data.slowStatements.rows.map((row) => (
                  <tr key={row.queryId}>
                    <th scope="row">
                      <bdi>{row.queryId}</bdi>
                    </th>
                    <td>{formatNumber(row.calls)}</td>
                    <td>{formatNumber(row.totalExecMs, { maximumFractionDigits: 2 })}</td>
                    <td>{formatNumber(row.meanExecMs, { maximumFractionDigits: 2 })}</td>
                    <td>{formatNumber(row.rows)}</td>
                  </tr>
                ))}
              </OperatorTable>
            ) : (
              <p>
                {data.slowStatements.extensionInstalled
                  ? text(
                      "Statement metrics are unavailable or have no rows. This does not establish that queries are fast.",
                      "مقاييس الاستعلامات غير متاحة أو بلا صفوف. هذا لا يعني أن الاستعلامات سريعة.",
                    )
                  : text(
                      "The optional pg_stat_statements extension is not installed. Connection metrics remain available.",
                      "إضافة pg_stat_statements الاختيارية غير مثبتة. مقاييس الاتصالات متاحة.",
                    )}
              </p>
            )}
          </section>
        </>
      )}
    </OperatorSnapshot>
  );
}
