"use client";
import { ActionButton } from "@/components/ui/design-system";

interface DiagnosticRow {
  installationId: string;
  platform: string;
  appVersion: string;
  receivedAt: string;
  expiresAt: string;
  snapshot: {
    bridgeVersion: number;
    capabilities: string[];
    configRevision: string | null;
    configAppliedAt: string | null;
    lastConfigCheckAt: string | null;
    runtimeAllowed: boolean;
    firebaseConfigured: boolean;
    ads: { status: string; lastEvent: string; errorCode: number | null };
  };
}
export function AdminMobileDiagnostics({
  ar,
  accountId,
  setAccountId,
  rows,
  busy,
  load,
}: {
  ar: boolean;
  accountId: string;
  setAccountId(value: string): void;
  rows: unknown;
  busy: boolean;
  load(): void;
}) {
  const copy = (en: string, arabic: string) => (ar ? arabic : en);
  const diagnostics = Array.isArray(rows) ? (rows.slice(0, 20) as DiagnosticRow[]) : null;
  return (
    <section aria-labelledby="mobile-diagnostics-heading">
      <h2 id="mobile-diagnostics-heading">{copy("App diagnostics", "تشخيص التطبيق")}</h2>
      <p>
        {copy(
          "Latest consented snapshots only, retained for seven days. No-fill is a delivery outcome, not proof of a code defect. A reported READY state does not prove a Google impression.",
          "آخر تقارير التشخيص الموافق عليها فقط، وتُحذف بعد سبعة أيام. عدم توفر إعلان ليس بالضرورة عيبًا في الكود، وحالة READY لا تثبت ظهور إعلان من Google.",
        )}
      </p>
      <label>
        {copy("Diagnostic account ID", "معرّف حساب التشخيص")}
        <input
          value={accountId}
          disabled={busy}
          onChange={(event) => setAccountId(event.target.value)}
          autoComplete="off"
        />
      </label>
      <ActionButton
        disabled={busy || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(accountId)}
        onClick={load}
      >
        {copy("Read app diagnostics", "قراءة تشخيص التطبيق")}
      </ActionButton>
      {diagnostics && diagnostics.length === 0 && (
        <p role="status">
          {copy(
            "No current consented diagnostic snapshot. The app may be offline, opted out, or not configured for diagnostics.",
            "لا يوجد تقرير تشخيص حالي بموافقة المستخدم. قد يكون التطبيق غير متصل أو لم يوافق المستخدم أو لم تُفعّل إعدادات التشخيص.",
          )}
        </p>
      )}
      {diagnostics?.map((row) => (
        <article key={row.installationId}>
          <h3>
            {row.platform} {row.appVersion} — {row.installationId.slice(0, 8)}
          </h3>
          <dl>
            <dt>{copy("Advertising state", "حالة الإعلانات")}</dt>
            <dd>{row.snapshot.ads.status}</dd>
            <dt>{copy("Last ad event / SDK code", "آخر حدث إعلان / كود SDK")}</dt>
            <dd>
              {row.snapshot.ads.lastEvent} / {row.snapshot.ads.errorCode ?? "—"}
            </dd>
            <dt>{copy("Applied configuration", "نسخة الإعدادات المطبقة")}</dt>
            <dd>{row.snapshot.configRevision?.slice(0, 12) ?? "—"}</dd>
            <dt>{copy("Applied / last checked", "آخر تطبيق / فحص للإعدادات")}</dt>
            <dd>
              {row.snapshot.configAppliedAt ?? "—"} / {row.snapshot.lastConfigCheckAt ?? "—"}
            </dd>
            <dt>{copy("Runtime / Firebase", "التكاملات الأصلية / Firebase")}</dt>
            <dd>
              {String(row.snapshot.runtimeAllowed)} / {String(row.snapshot.firebaseConfigured)}
            </dd>
            <dt>{copy("Bridge / supported features", "الربط / القدرات المدعومة")}</dt>
            <dd>
              {row.snapshot.bridgeVersion} / {row.snapshot.capabilities.join(", ")}
            </dd>
            <dt>{copy("Received / expires", "الاستلام / انتهاء الاحتفاظ")}</dt>
            <dd>
              {row.receivedAt} / {row.expiresAt}
            </dd>
          </dl>
        </article>
      ))}
    </section>
  );
}
