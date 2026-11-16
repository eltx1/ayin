"use client";
import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { requestMobile, supportsMobile } from "@/lib/mobile-bridge";
import { notificationTypes, type NotificationPreferences } from "@/lib/mobile-config";
import {
  disableMobileNotifications,
  enableMobileNotifications,
  getMobileServerState,
  getMobileState,
  initializeMobile,
  refreshMobileConfig,
  requestMobilePrivacy,
  setMobileAdultAffirmation,
  setMobileAnalyticsConsent,
  subscribeMobile,
} from "@/lib/mobile-runtime";
import styles from "@/app/(viewer)/account/account.module.css";
import {
  getMobileDiagnosticSnapshot,
  sendMobileDiagnostics,
  mobileDiagnosticsEnabled,
  enableMobileDiagnostics,
  disableMobileDiagnostics,
  subscribeMobileDiagnostics,
  getMobileDiagnosticsServerState,
} from "@/lib/mobile-diagnostics";
export function MobileSettings() {
  const state = useSyncExternalStore(subscribeMobile, getMobileState, getMobileServerState);
  const diagnosticsEnabled = useSyncExternalStore(
    subscribeMobileDiagnostics,
    mobileDiagnosticsEnabled,
    getMobileDiagnosticsServerState,
  );
  const { locale } = useI18n(),
    ar = locale === "ar";
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  if (!state.ready) return null;
  const copy = (en: string, arabic: string) => (ar ? arabic : en);
  const preferences = draft ?? state.preferences;
  const labels: Record<string, string> = {
    system: "النظام",
    channel: "القنوات",
    video: "الفيديوهات",
    comment: "التعليقات",
    subscription: "المتابعات",
    moderation: "الإشراف",
    monetization: "تحقيق الربح",
  };
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(copy("Preferences saved.", "تم حفظ التفضيلات."));
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "ANALYTICS_CHOICE_NOT_PERSISTED"
          ? copy(
              "Analytics is disabled for this session, but your choice could not be saved. Allow local storage and retry before reopening AYIN.",
              "التحليلات متوقفة في الجلسة الحالية، لكن تعذر حفظ اختيارك. اسمح بالتخزين المحلي وأعد المحاولة قبل إعادة فتح AYIN.",
            )
          : copy(
              "Could not complete the request. Check app permissions and try again. Your video viewing remains available.",
              "تعذر إكمال الطلب. راجع أذونات التطبيق وحاول مجددًا. تظل مشاهدة الفيديو متاحة.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.securityCard} aria-labelledby="mobile-preferences">
      <h2 id="mobile-preferences">
        {copy("App privacy and notifications", "خصوصية التطبيق والإشعارات")}
      </h2>
      {state.info?.upgradeRequired && (
        <p role="status">
          {copy(
            "Update AYIN from the store to use app services. You can continue watching.",
            "حدّث AYIN من المتجر لاستخدام خدمات التطبيق. يمكنك متابعة المشاهدة.",
          )}
        </p>
      )}
      {state.error && (
        <p role="status">
          {copy(
            "App services are unavailable. Watching remains available.",
            "خدمات التطبيق غير متاحة حاليًا. يمكنك متابعة المشاهدة.",
          )}
        </p>
      )}
      <details>
        <summary>{copy("App configuration and diagnostics", "إعدادات التطبيق والتشخيص")}</summary>
        <p>
          {copy(
            "Configuration updates automatically in the foreground and activates after video, ads and uploads finish.",
            "تُراجع الإعدادات تلقائيًا أثناء الاستخدام وتُطبق بعد انتهاء الفيديو والإعلان والرفع الجاري.",
          )}
        </p>
        <dl>
          <dt>{copy("Applied configuration", "نسخة الإعدادات المطبقة")}</dt>
          <dd>{state.configRevision?.slice(0, 12) ?? "—"}</dd>
          <dt>{copy("Last check", "آخر فحص")}</dt>
          <dd>{state.lastConfigCheckAt ?? "—"}</dd>
          <dt>{copy("Pending safe activation", "تحديث ينتظر وقتًا آمنًا")}</dt>
          <dd>{String(state.configPending)}</dd>
          <dt>{copy("Advertising state", "حالة الإعلانات")}</dt>
          <dd>{getMobileDiagnosticSnapshot().ads.status}</dd>
          <dt>{copy("Diagnostic sharing", "مشاركة التشخيص")}</dt>
          <dd>{diagnosticsEnabled ? copy("Enabled", "مفعّلة") : copy("Off", "متوقفة")}</dd>
        </dl>
        {state.configFetchFailed && (
          <p role="status">
            {copy(
              "Could not fetch new settings. The last valid settings or safe recovery defaults remain active.",
              "تعذر جلب إعدادات جديدة؛ تبقى آخر إعدادات صالحة أو إعدادات الاستعادة الآمنة فعّالة.",
            )}
          </p>
        )}
        <button disabled={busy} onClick={() => void perform(() => refreshMobileConfig())}>
          {copy("Check settings now", "فحص الإعدادات الآن")}
        </button>{" "}
        <p>
          {copy(
            "Optional operational reports share app/bridge versions, configuration revision and bounded SDK error codes with AYIN administrators for seven days. No email, messages, tokens or ad-unit values are sent. Sharing must be enabled again in each new app session; failed withdrawal is retried. This is separate from Firebase Analytics.",
            "التشخيص الاختياري يشارك إصدار التطبيق والربط ونسخة الإعدادات وأكواد أخطاء SDK المحدودة مع إدارة AYIN لمدة سبعة أيام، دون البريد أو الرسائل أو الرموز أو قيم وحدات الإعلان. يجب تفعيله مجددًا في كل جلسة تطبيق جديدة، ويُعاد طلب الإيقاف إن تعذر تأكيده. وهو مستقل عن Firebase Analytics.",
          )}
        </p>
        <button disabled={busy} onClick={() => void perform(enableMobileDiagnostics)}>
          {copy("Allow diagnostic sharing", "السماح بمشاركة التشخيص")}
        </button>{" "}
        <button
          disabled={busy || !diagnosticsEnabled}
          onClick={() =>
            void perform(async () => {
              if (!(await sendMobileDiagnostics())) throw new Error("DIAGNOSTIC_NOT_SENT");
            })
          }
        >
          {copy("Send current diagnostic", "إرسال التشخيص الحالي")}
        </button>{" "}
        <button disabled={busy} onClick={() => void perform(disableMobileDiagnostics)}>
          {copy("Stop sharing and delete report", "إيقاف المشاركة وحذف التقرير")}
        </button>
      </details>
      <label>
        <input
          type="checkbox"
          checked={state.adultAffirmed}
          disabled={busy}
          onChange={(e) => void perform(() => setMobileAdultAffirmation(e.target.checked))}
        />{" "}
        {copy(
          "I am 18 or older. This choice stays on this device and is not sent to Analytics.",
          "عمري 18 عامًا أو أكثر. يُحفظ هذا الاختيار على الجهاز ولا يُرسل للتحليلات.",
        )}
      </label>
      {state.error && (
        <button
          className={styles.secondaryButton}
          disabled={busy}
          onClick={() => void perform(() => initializeMobile(AbortSignal.timeout(20000)))}
        >
          {copy("Retry app services", "إعادة محاولة خدمات التطبيق")}
        </button>
      )}
      {supportsMobile("privacy") && (
        <div>
          <button
            className={styles.secondaryButton}
            disabled={
              busy ||
              state.info?.runtimeAllowed === false ||
              !state.adultAffirmed ||
              state.config?.ads.audience === "unknown"
            }
            onClick={() => void perform(requestMobilePrivacy)}
          >
            {copy("Review advertising consent", "مراجعة الموافقة على الإعلانات")}
          </button>{" "}
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void perform(() => requestMobile("privacy.options", {}, 120000))}
          >
            {copy("Privacy options", "خيارات الخصوصية")}
          </button>
        </div>
      )}
      <label>
        <input
          type="checkbox"
          checked={state.analyticsConsent}
          disabled={
            busy ||
            !state.adultAffirmed ||
            !state.config?.analytics.enabled ||
            !supportsMobile("analytics")
          }
          onChange={(e) => void perform(() => setMobileAnalyticsConsent(e.target.checked))}
        />{" "}
        {copy(
          "Optional app analytics and crash diagnostics",
          "التحليلات وتشخيص الأعطال الاختياريان",
        )}
      </label>
      <p>
        {copy(
          "Analytics excludes your email, search text, messages and session tokens. You can turn it off here.",
          "لا تتضمن التحليلات بريدك أو نص البحث أو الرسائل أو رموز الجلسة. يمكنك إيقافها هنا.",
        )}
      </p>
      {supportsMobile("notifications") && (
        <fieldset
          disabled={
            busy || state.info?.runtimeAllowed === false || !state.config?.notifications.enabled
          }
        >
          <legend>
            {copy("Choose notifications on this device", "اختيار إشعارات هذا الجهاز")}
          </legend>
          {notificationTypes.map((type) => (
            <label key={type} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={preferences[type]}
                onChange={(e) => setDraft({ ...preferences, [type]: e.target.checked })}
              />{" "}
              {ar ? labels[type] : type}
            </label>
          ))}
          <button
            className={styles.secondaryButton}
            disabled={!Object.values(preferences).some(Boolean)}
            onClick={() => void perform(() => enableMobileNotifications(preferences))}
          >
            {copy("Enable / save notifications", "تفعيل / حفظ الإشعارات")}
          </button>{" "}
          <button
            className={styles.secondaryButton}
            onClick={() => void perform(disableMobileNotifications)}
          >
            {copy("Turn off on this device", "الإيقاف على هذا الجهاز")}
          </button>
          <p>
            {copy(
              "Sign in before enabling notifications. Permission is requested only when you choose Enable.",
              "سجّل الدخول قبل تفعيل الإشعارات. يُطلب الإذن عند اختيار التفعيل فقط.",
            )}
          </p>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
