"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  StatusNotice,
} from "@/components/ui/design-system";
import {
  checkVastTag,
  extractAdUnitPath,
  extractVastTagUrl,
  parseCueTimes,
  previewCuePoints,
  gamAdUnitPathPattern,
  isHttpsUrl,
  type AdManagerOverview,
  type AdManagerSlot,
  type AdManagerSlotInput,
  type AdManagerVideoInput,
  type AdSlotDevice,
} from "@/lib/admin-ad-manager";
import { readAdminApiError, adminVerificationRequired } from "@/lib/admin-reauthentication";
import { apiBaseUrl } from "@/lib/api";
import { mobileAdUnitProvider, parseMobileConfig, type MobileConfig } from "@/lib/mobile-config";
import { useAdminAccess } from "./admin-access";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";
import styles from "./admin-ad-manager.module.css";

type Copy = (en: string, ar: string) => string;
type Tab = "web" | "video" | "app";
type Notice = { tone: "success" | "danger" | "warning" | "info"; text: string } | null;
type Request = <T>(path: string, method?: string, payload?: unknown) => Promise<T>;

class AdManagerRequestError extends Error {
  constructor(
    message: string,
    readonly stepUp: boolean,
  ) {
    super(message);
  }
}

const deviceLabels: Record<AdSlotDevice, [string, string]> = {
  MOBILE: ["Phones", "موبايل"],
  DESKTOP: ["Computers", "كمبيوتر"],
  TV: ["TV", "تلفزيون"],
};

export function AdminAdManager() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const copy: Copy = useCallback((en, arabic) => (ar ? arabic : en), [ar]);
  const { session, getScopeLease, subscribeScopeInvalidation } = useAdminAccess();
  const [overview, setOverview] = useState<AdManagerOverview | null>(null);
  const [appConfig, setAppConfig] = useState<MobileConfig | null>(null);
  const [appAllowed, setAppAllowed] = useState(false);
  const [tab, setTab] = useState<Tab>("web");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(
    () =>
      subscribeScopeInvalidation(() => {
        active.current?.abort();
        setOverview(null);
        setAppConfig(null);
        setNotice(null);
        setBusy(null);
      }),
    [subscribeScopeInvalidation],
  );
  useEffect(() => () => active.current?.abort(), []);

  const request: Request = useCallback(
    async <T,>(path: string, method = "GET", payload?: unknown) => {
      const lease = getScopeLease();
      if (!lease) throw new AdManagerRequestError("ADMIN_SESSION_UNAVAILABLE", false);
      const response = await fetch(apiBaseUrl + path, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-ayin-expected-account": lease.session.accountId,
          "x-ayin-expected-session": lease.session.sessionId,
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) {
        const stepUp = await adminVerificationRequired(response);
        throw new AdManagerRequestError(await readAdminApiError(response), stepUp);
      }
      if (lease !== getScopeLease()) throw new AdManagerRequestError("ADMIN_CHANGED", false);
      return (await response.json()) as T;
    },
    [getScopeLease],
  );

  const failure = useCallback(
    (error: unknown) => {
      if (error instanceof AdManagerRequestError && error.stepUp) {
        setNotice({
          tone: "warning",
          text: copy(
            "For security, confirm your password first: press “Verify session” at the top, then press Save again.",
            "للأمان لازم تأكيد كلمة السر الأول: اضغط زر “Verify session” فوق، وبعدها اضغط حفظ تاني.",
          ),
        });
        return;
      }
      const detail = error instanceof Error ? error.message : "";
      setNotice({
        tone: "danger",
        text: copy("Not saved. ", "لم يتم الحفظ. ") + detail,
      });
    },
    [copy],
  );

  const load = useCallback(async () => {
    const lease = getScopeLease();
    if (!lease) return;
    setLoading(true);
    try {
      setOverview(await request<AdManagerOverview>("/admin/ad-manager"));
      const superadmin = lease.session.roles.some((role) => role === "SUPERADMIN");
      setAppAllowed(superadmin);
      if (superadmin) setAppConfig(parseMobileConfig(await request("/admin/mobile/config")));
    } catch (error) {
      failure(error);
    } finally {
      setLoading(false);
    }
  }, [failure, getScopeLease, request]);

  const accountId = session?.accountId ?? null;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, load]);

  const save = useCallback(
    async (label: string, operation: () => Promise<void>, success: string) => {
      if (busy) return;
      setBusy(label);
      setNotice(null);
      try {
        await operation();
        setNotice({ tone: "success", text: success });
      } catch (error) {
        failure(error);
      } finally {
        setBusy(null);
      }
    },
    [busy, failure],
  );

  const saved = copy(
    "Saved. Changes reach viewers within a minute.",
    "تم الحفظ. التغيير بيوصل للمشاهدين خلال دقيقة.",
  );

  return (
    <div className={styles.page} dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={copy("Monetization", "تحقيق الدخل")}
        title={copy("Ad manager", "إدارة الإعلانات")}
        description={copy(
          "Everything in one place: website ad slots, video (player) ads and app ads. Paste the code or tag from Google Ad Manager and save.",
          "كل الإعلانات في مكان واحد: أماكن إعلانات الموقع، إعلانات الفيديو (البلاير)، وإعلانات التطبيق. الصق الكود أو التاج من Google Ad Manager واحفظ.",
        )}
        actions={
          <ActionButton tone="secondary" onClick={() => void load()} pending={loading}>
            {copy("Refresh", "تحديث")}
          </ActionButton>
        }
      />
      <AdminAdvertisingNavigation current="manager" />

      {notice ? (
        <StatusNotice tone={notice.tone} announce="polite">
          {notice.text}
        </StatusNotice>
      ) : null}

      {!overview ? (
        <StatusNotice tone="info">
          {loading
            ? copy("Loading advertising settings…", "جاري تحميل إعدادات الإعلانات…")
            : copy(
                "Advertising settings are not loaded yet. Press Refresh.",
                "الإعدادات لسه ما اتحملتش. اضغط تحديث.",
              )}
        </StatusNotice>
      ) : (
        <>
          <Summary
            copy={copy}
            overview={overview}
            appConfig={appConfig}
            busy={busy}
            onEmergency={(enabled) =>
              void save(
                "emergency",
                async () =>
                  setOverview(
                    await request<AdManagerOverview>("/admin/ad-manager/emergency", "PUT", {
                      enabled,
                      reason: enabled
                        ? "Emergency stop from the simple ad manager"
                        : "Advertising resumed from the simple ad manager",
                    }),
                  ),
                enabled
                  ? copy("All ads are stopped.", "تم إيقاف كل الإعلانات.")
                  : copy("Ads are running again.", "الإعلانات رجعت تشتغل."),
              )
            }
          />

          <div
            className={styles.tabs}
            role="tablist"
            aria-label={copy("Ad types", "أنواع الإعلانات")}
          >
            {(
              [
                ["web", copy("Website & WebView", "إعلانات الموقع والـ WebView")],
                ["video", copy("Video (player)", "إعلانات الفيديو (البلاير)")],
                ["app", copy("App", "إعلانات التطبيق")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={styles.tab}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "web" ? (
            <WebAds
              copy={copy}
              ar={ar}
              overview={overview}
              busy={busy}
              onMaster={(masterEnabled) =>
                void save(
                  "web-master",
                  async () =>
                    setOverview(
                      await request<AdManagerOverview>("/admin/ad-manager/web", "PUT", {
                        masterEnabled,
                      }),
                    ),
                  saved,
                )
              }
              onSlot={(key, input) =>
                void save(
                  `slot:${key}`,
                  async () =>
                    setOverview(
                      await request<AdManagerOverview>(
                        `/admin/ad-manager/web/slots/${encodeURIComponent(key)}`,
                        "PUT",
                        input,
                      ),
                    ),
                  saved,
                )
              }
            />
          ) : null}

          {tab === "video" ? (
            <VideoAds
              key={JSON.stringify(overview.video)}
              copy={copy}
              video={overview.video}
              busy={busy}
              onSave={(input) =>
                void save(
                  "video",
                  async () =>
                    setOverview(
                      await request<AdManagerOverview>("/admin/ad-manager/video", "PUT", input),
                    ),
                  saved,
                )
              }
            />
          ) : null}

          {tab === "app" ? (
            appAllowed && appConfig ? (
              <AppAds
                key={JSON.stringify(appConfig)}
                copy={copy}
                config={appConfig}
                busy={busy}
                onSave={(config) =>
                  void save(
                    "app",
                    async () => {
                      await request("/admin/mobile/config", "PUT", {
                        config: parseMobileConfig(config),
                        reason: "App ads updated from the simple ad manager",
                      });
                      setAppConfig(parseMobileConfig(await request("/admin/mobile/config")));
                    },
                    saved,
                  )
                }
              />
            ) : (
              <StatusNotice tone="info">
                {copy(
                  "App ad settings are managed by a superadministrator.",
                  "إعدادات إعلانات التطبيق متاحة للسوبر أدمن فقط.",
                )}
              </StatusNotice>
            )
          ) : null}

          <p className={styles.advanced}>
            {copy(
              "Need direct campaigns, advertisers or per-channel rules?",
              "محتاج حملات مباشرة أو معلنين أو قواعد لكل قناة؟",
            )}{" "}
            <ActionLink href={ar ? "/ar/admin/advertising" : "/admin/advertising"} tone="quiet">
              {copy("Open advanced tools", "افتح الأدوات المتقدمة")}
            </ActionLink>
          </p>
        </>
      )}
    </div>
  );
}

function Summary({
  copy,
  overview,
  appConfig,
  busy,
  onEmergency,
}: {
  copy: Copy;
  overview: AdManagerOverview;
  appConfig: MobileConfig | null;
  busy: string | null;
  onEmergency: (enabled: boolean) => void;
}) {
  const liveSlots = overview.web.slots.filter((slot) => slot.enabled).length;
  const videoBreaks = [
    overview.video.preRoll,
    overview.video.midRoll,
    overview.video.postRoll,
  ].filter((item) => item.enabled && item.vastTagUrl).length;
  const state = (on: boolean) =>
    overview.emergencyStop ? (
      <DataBadge tone="danger">{copy("Stopped", "متوقف")}</DataBadge>
    ) : on ? (
      <DataBadge tone="success">{copy("Running", "شغّال")}</DataBadge>
    ) : (
      <DataBadge>{copy("Off", "مقفول")}</DataBadge>
    );
  return (
    <section className={styles.summary} aria-label={copy("Status", "الحالة")}>
      <div className={styles.summaryCard}>
        <span>{copy("Website ads", "إعلانات الموقع")}</span>
        {state(overview.web.masterEnabled && liveSlots > 0)}
        <small>
          {copy(
            `${liveSlots} of ${overview.web.slots.length} slots on`,
            `${liveSlots} من ${overview.web.slots.length} أماكن شغالة`,
          )}
        </small>
      </div>
      <div className={styles.summaryCard}>
        <span>{copy("Video ads", "إعلانات الفيديو")}</span>
        {state(overview.video.masterEnabled && videoBreaks > 0)}
        <small>{copy(`${videoBreaks} of 3 breaks on`, `${videoBreaks} من 3 فواصل شغالة`)}</small>
      </div>
      <div className={styles.summaryCard}>
        <span>{copy("App ads", "إعلانات التطبيق")}</span>
        {appConfig ? state(appConfig.ads.enabled) : <DataBadge>—</DataBadge>}
        <small>
          {appConfig?.ads.testMode
            ? copy("Test mode (Google test ads)", "وضع الاختبار (إعلانات جوجل التجريبية)")
            : copy("Live units", "وحدات حقيقية")}
        </small>
      </div>
      <div className={styles.summaryCard} data-danger={overview.emergencyStop ? "true" : undefined}>
        <span>{copy("Emergency stop", "إيقاف الطوارئ")}</span>
        <small>
          {copy(
            "Stops every website and video ad immediately.",
            "يوقف كل إعلانات الموقع والفيديو فورًا.",
          )}
        </small>
        <ActionButton
          tone={overview.emergencyStop ? "primary" : "danger"}
          pending={busy === "emergency"}
          onClick={() => onEmergency(!overview.emergencyStop)}
        >
          {overview.emergencyStop
            ? copy("Resume ads", "رجّع الإعلانات")
            : copy("Stop all ads now", "أوقف كل الإعلانات")}
        </ActionButton>
      </div>
    </section>
  );
}

function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true" />
      <span className={styles.switchText}>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

function WebAds({
  copy,
  ar,
  overview,
  busy,
  onMaster,
  onSlot,
}: {
  copy: Copy;
  ar: boolean;
  overview: AdManagerOverview;
  busy: string | null;
  onMaster: (enabled: boolean) => void;
  onSlot: (key: string, input: AdManagerSlotInput) => void;
}) {
  const number = (key: string) => overview.web.slots.findIndex((slot) => slot.key === key) + 1;
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Switch
          checked={overview.web.masterEnabled}
          disabled={busy === "web-master"}
          onChange={onMaster}
          label={copy("Website ads master switch", "المفتاح الرئيسي لإعلانات الموقع")}
          hint={copy(
            "When off, no slot below shows anything. The same slots also show inside the app's WebView when “Website ads inside the app” is on in the App tab.",
            "لو مقفول، مفيش أي مكان من اللي تحت هيظهر. نفس الأماكن دي بتظهر جوه التطبيق (WebView) لو فعّلت “إعلانات الموقع جوه التطبيق” من تبويب التطبيق.",
          )}
        />
      </div>

      <SlotMap copy={copy} number={number} slots={overview.web.slots} />

      <StatusNotice tone="info" title={copy("How to fill a slot", "إزاي تملا أي مكان")}>
        {copy(
          "Choose one of two ways for each slot: (1) Ad code: paste the HTML / JavaScript tag exactly as your ad network gives it — it runs in a safe isolated frame. (2) Google Ad Manager unit: paste only the ad unit path, e.g. /23374456398/AYIN/home_top, and create the unit in Ad Manager with the suggested sizes.",
          "لكل مكان اختار طريقة من اتنين: (1) كود إعلان: الصق كود الـ HTML / JavaScript زي ما شبكة الإعلانات بتديهولك بالظبط، وهيشتغل جوه إطار معزول وآمن. (2) وحدة Google Ad Manager: الصق مسار الوحدة بس، مثلًا ‎/23374456398/AYIN/home_top‎، واعمل الوحدة في Ad Manager بالمقاسات المقترحة.",
        )}
      </StatusNotice>

      <div className={styles.slotList}>
        {overview.web.slots.map((slot) => (
          <SlotCard
            key={`${slot.key}:${slot.updatedAt ?? ""}`}
            copy={copy}
            ar={ar}
            number={number(slot.key)}
            slot={slot}
            masterEnabled={overview.web.masterEnabled}
            saving={busy === `slot:${slot.key}`}
            onSave={(input) => onSlot(slot.key, input)}
          />
        ))}
      </div>
    </section>
  );
}

function SlotMap({
  copy,
  number,
  slots,
}: {
  copy: Copy;
  number: (key: string) => number;
  slots: AdManagerSlot[];
}) {
  const marker = (key: string) => {
    const slot = slots.find((item) => item.key === key);
    return (
      <a
        className={styles.marker}
        data-on={slot?.enabled ? "true" : undefined}
        href={`#ad-slot-${key}`}
        title={slot ? `${number(key)}` : undefined}
      >
        {number(key)}
      </a>
    );
  };
  return (
    <div
      className={styles.map}
      aria-label={copy("Where each slot appears", "مكان كل وحدة إعلانية")}
    >
      <figure className={styles.wireframe}>
        <figcaption>{copy("Home page", "الصفحة الرئيسية")}</figcaption>
        <div className={styles.wfBar}>{copy("Header", "الهيدر")}</div>
        {marker("header_below")}
        <div className={styles.wfHero}>{copy("Featured banner", "البانر الكبير")}</div>
        {marker("home_top")}
        <div className={styles.wfRow} />
        <div className={styles.wfRow} />
        {marker("home_between_rows")}
        <div className={styles.wfRow} />
        {marker("footer_above")}
        <div className={styles.wfBar}>{copy("Footer", "الفوتر")}</div>
        <div className={styles.wfPhone}>
          <span>{copy("Phones: pinned at the bottom", "الموبايل: لاصق تحت")}</span>
          {marker("mobile_anchor")}
        </div>
      </figure>
      <figure className={styles.wireframe}>
        <figcaption>{copy("Watch page", "صفحة المشاهدة")}</figcaption>
        <div className={styles.wfBar}>{copy("Header", "الهيدر")}</div>
        {marker("header_below")}
        <div className={styles.wfColumns}>
          <div>
            <div className={styles.wfPlayer}>{copy("Player", "البلاير")}</div>
            {marker("watch_below_player")}
            <div className={styles.wfText} />
            {marker("watch_above_comments")}
            <div className={styles.wfText}>{copy("Comments", "التعليقات")}</div>
          </div>
          <div>
            {marker("desktop_sidebar")}
            <div className={styles.wfThumb} />
            <div className={styles.wfThumb} />
          </div>
        </div>
        {marker("footer_above")}
        <div className={styles.wfBar}>{copy("Footer", "الفوتر")}</div>
      </figure>
      <ul className={styles.otherPages}>
        {[
          "content_detail",
          "browse_directory",
          "search_between_results",
          "channel_between_rows",
          "tv_directory",
        ].map((key) => {
          const slot = slots.find((item) => item.key === key);
          return slot ? (
            <li key={key}>
              {marker(key)} <span>{copy(slot.name.en, slot.name.ar)}</span>
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}

function SlotCard({
  copy,
  ar,
  number,
  slot,
  masterEnabled,
  saving,
  onSave,
}: {
  copy: Copy;
  ar: boolean;
  number: number;
  slot: AdManagerSlot;
  masterEnabled: boolean;
  saving: boolean;
  onSave: (input: AdManagerSlotInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(slot.enabled);
  const [source, setSource] = useState<AdManagerSlotInput["source"]>(
    slot.source === "HOUSE" ? "NONE" : slot.source,
  );
  const [code, setCode] = useState(slot.code ?? "");
  const [adUnitPath, setAdUnitPath] = useState(slot.adUnitPath ?? "");
  const [height, setHeight] = useState(slot.height ? String(slot.height) : "");
  const [devices, setDevices] = useState<AdSlotDevice[]>(slot.devices);
  const id = `ad-slot-${slot.key}`;

  const unitError =
    source === "GAM_UNIT" && adUnitPath && !gamAdUnitPathPattern.test(adUnitPath)
      ? copy(
          "The path must look like /NETWORK_CODE/unit_name, e.g. /23374456398/AYIN/home_top",
          "المسار لازم يكون بالشكل ‎/رقم_الشبكة/اسم_الوحدة‎ مثلًا ‎/23374456398/AYIN/home_top",
        )
      : null;
  const heightValue = height.trim() ? Number(height) : null;
  const heightError =
    heightValue !== null &&
    (!Number.isInteger(heightValue) || heightValue < 20 || heightValue > 1200)
      ? copy("Height must be between 20 and 1200 pixels.", "الارتفاع لازم يكون بين 20 و 1200 بكسل.")
      : null;
  const missing =
    enabled &&
    ((source === "CODE" && !code.trim()) ||
      (source === "GAM_UNIT" && !adUnitPath.trim()) ||
      source === "NONE");
  const invalid = Boolean(unitError || heightError || missing || devices.length === 0);

  const status = !slot.enabled ? (
    <DataBadge>{copy("Off", "مقفول")}</DataBadge>
  ) : !masterEnabled ? (
    <DataBadge tone="warning">
      {copy("On, master switch off", "شغال بس المفتاح الرئيسي مقفول")}
    </DataBadge>
  ) : (
    <DataBadge tone="success">{copy("Running", "شغّال")}</DataBadge>
  );
  const sourceLabel =
    slot.source === "CODE"
      ? copy("Ad code", "كود إعلان")
      : slot.source === "GAM_UNIT"
        ? copy("Ad Manager unit", "وحدة Ad Manager")
        : slot.source === "HOUSE"
          ? copy("House image (advanced tools)", "صورة إعلان داخلي (من الأدوات المتقدمة)")
          : copy("Nothing yet", "لسه فاضي");

  return (
    <article className={styles.slot} id={id} data-open={open ? "true" : undefined}>
      <header className={styles.slotHead}>
        <span className={styles.slotNumber} data-on={slot.enabled ? "true" : undefined}>
          {number}
        </span>
        <div className={styles.slotTitle}>
          <h3>{ar ? slot.name.ar : slot.name.en}</h3>
          <p>{ar ? slot.where.ar : slot.where.en}</p>
          <div className={styles.slotMeta}>
            {status}
            <DataBadge tone="info">{sourceLabel}</DataBadge>
            <span dir="ltr" className={styles.sizes}>
              {slot.sizes.map(([w, h]) => `${w}×${h}`).join(" · ")}
            </span>
          </div>
        </div>
        <ActionButton
          tone="secondary"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`${id}-form`}
        >
          {open ? copy("Close", "إغلاق") : copy("Edit", "تعديل")}
        </ActionButton>
      </header>

      {open ? (
        <form
          id={`${id}-form`}
          className={styles.slotForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (invalid) return;
            onSave({
              enabled: enabled && source !== "NONE",
              source,
              code: code.trim() ? code : null,
              adUnitPath: source === "GAM_UNIT" ? adUnitPath.trim() || null : null,
              height: heightValue,
              devices,
            });
          }}
        >
          <Switch
            checked={enabled}
            onChange={setEnabled}
            label={copy("Show ads in this slot", "شغّل الإعلان في المكان ده")}
          />

          <fieldset className={styles.choices}>
            <legend>{copy("What goes in this slot?", "إيه اللي هيتعرض هنا؟")}</legend>
            {(
              [
                [
                  "CODE",
                  copy("Ad code (HTML / ad tag)", "كود إعلان (HTML / Ad tag)"),
                  copy(
                    "Any network: paste the full code as given.",
                    "أي شبكة إعلانات: الصق الكود كامل زي ما هو.",
                  ),
                ],
                [
                  "GAM_UNIT",
                  copy("Google Ad Manager unit", "وحدة Google Ad Manager"),
                  copy("Paste only the ad unit path.", "الصق مسار الوحدة بس."),
                ],
                ["NONE", copy("Nothing (slot off)", "ولا حاجة (المكان مقفول)"), ""],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={styles.choice}
                data-selected={source === value ? "true" : undefined}
              >
                <input
                  type="radio"
                  name={`${id}-source`}
                  value={value}
                  checked={source === value}
                  onChange={() => {
                    setSource(value);
                    if (value === "NONE") setEnabled(false);
                  }}
                />
                <span>
                  <strong>{label}</strong>
                  {hint ? <small>{hint}</small> : null}
                </span>
              </label>
            ))}
          </fieldset>

          {source === "CODE" ? (
            <div className={styles.field}>
              <label htmlFor={`${id}-code`}>{copy("Ad code", "كود الإعلان")}</label>
              <textarea
                id={`${id}-code`}
                dir="ltr"
                spellCheck={false}
                rows={8}
                value={code}
                maxLength={20000}
                placeholder={'<script src="https://..."></script>\n<div id="..."></div>'}
                onChange={(event) => setCode(event.target.value)}
              />
              <small>
                {copy(
                  "Runs inside an isolated frame on its own, so a broken or malicious tag cannot affect AYIN pages, cookies or viewer accounts.",
                  "الكود بيشتغل جوه إطار معزول لوحده، فلو فيه مشكلة أو كود ضار مش هيأثر على صفحات عين ولا الكوكيز ولا حسابات المشاهدين.",
                )}
              </small>
              <label htmlFor={`${id}-height`}>
                {copy("Fixed height in pixels (optional)", "ارتفاع ثابت بالبكسل (اختياري)")}
              </label>
              <input
                id={`${id}-height`}
                inputMode="numeric"
                dir="ltr"
                value={height}
                placeholder={copy("Automatic", "تلقائي")}
                onChange={(event) => setHeight(event.target.value.replace(/[^\d]/gu, ""))}
              />
              {heightError ? <span className={styles.error}>{heightError}</span> : null}
            </div>
          ) : null}

          {source === "GAM_UNIT" ? (
            <div className={styles.field}>
              <label htmlFor={`${id}-unit`}>
                {copy("Ad unit path", "مسار الوحدة (Ad unit path)")}
              </label>
              <input
                id={`${id}-unit`}
                dir="ltr"
                spellCheck={false}
                value={adUnitPath}
                placeholder={`/23374456398/AYIN/${slot.key}`}
                onChange={(event) => setAdUnitPath(extractAdUnitPath(event.target.value))}
              />
              <small>
                {copy(
                  `In Ad Manager: Inventory → Ad units → New ad unit with sizes ${slot.sizes.map(([w, h]) => `${w}x${h}`).join(", ")}. Then copy the network code and unit code as /NETWORK/UNIT. You can also paste a GPT tag and the path is extracted.`,
                  `في Ad Manager: ‏Inventory ← Ad units ← New ad unit بالمقاسات ${slot.sizes.map(([w, h]) => `${w}x${h}`).join("، ")}. بعدها انسخ رقم الشبكة وكود الوحدة بالشكل ‎/الشبكة/الوحدة‎. وممكن تلصق تاج GPT كامل وهنطلّع المسار منه لوحدنا.`,
                )}
              </small>
              {unitError ? <span className={styles.error}>{unitError}</span> : null}
            </div>
          ) : null}

          <fieldset className={styles.devices}>
            <legend>{copy("Show on", "يظهر على")}</legend>
            {(Object.keys(deviceLabels) as AdSlotDevice[]).map((device) => (
              <label key={device}>
                <input
                  type="checkbox"
                  checked={devices.includes(device)}
                  onChange={(event) =>
                    setDevices(
                      event.target.checked
                        ? [...devices, device]
                        : devices.filter((item) => item !== device),
                    )
                  }
                />
                {copy(...deviceLabels[device])}
              </label>
            ))}
          </fieldset>

          {missing ? (
            <span className={styles.error}>
              {source === "NONE"
                ? copy(
                    "Choose code or an Ad Manager unit to turn the slot on.",
                    "اختار كود أو وحدة Ad Manager عشان تشغّل المكان.",
                  )
                : copy(
                    "Fill in the code or unit before turning the slot on.",
                    "اكتب الكود أو الوحدة قبل ما تشغّل المكان.",
                  )}
            </span>
          ) : null}
          {devices.length === 0 ? (
            <span className={styles.error}>
              {copy("Choose at least one device.", "اختار جهاز واحد على الأقل.")}
            </span>
          ) : null}

          <div className={styles.formActions}>
            <ActionButton type="submit" pending={saving} disabled={invalid}>
              {copy("Save slot", "احفظ المكان")}
            </ActionButton>
          </div>
        </form>
      ) : null}
    </article>
  );
}

type VastCheck = { tone: "success" | "warning" | "danger" | "info"; text: string } | null;

function formatClock(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function VideoAds({
  copy,
  video,
  busy,
  onSave,
}: {
  copy: Copy;
  video: AdManagerOverview["video"];
  busy: string | null;
  onSave: (input: AdManagerVideoInput) => void;
}) {
  const [draft, setDraft] = useState(video);
  const [cueText, setCueText] = useState(video.midRoll.cuePointsSec.map(formatClock).join(", "));
  const [previewMinutes, setPreviewMinutes] = useState(90);
  const [checks, setChecks] = useState<Record<string, VastCheck>>({});
  const breaks = [
    [
      "preRoll",
      copy("Pre-roll", "قبل الفيديو (Pre-roll)"),
      copy("Plays once before the video starts.", "بيظهر مرة واحدة قبل ما الفيديو يبدأ."),
    ],
    [
      "midRoll",
      copy("Mid-roll", "في نص الفيديو (Mid-roll)"),
      copy(
        "Breaks during the video, on the schedule below.",
        "فواصل أثناء الفيديو حسب المواعيد اللي هتحددها تحت.",
      ),
    ],
    [
      "postRoll",
      copy("Post-roll", "بعد الفيديو (Post-roll)"),
      copy("Plays once when the video ends.", "بيظهر مرة واحدة لما الفيديو يخلص."),
    ],
  ] as const;
  const parsedCues = parseCueTimes(cueText);
  const cueError =
    draft.midRoll.enabled && draft.midRoll.mode === "CUE_POINTS"
      ? parsedCues === null
        ? copy(
            "Write times like 5:00, 20:00, 1:05:00 (or minutes: 5, 20, 65).",
            "اكتب التوقيتات بالشكل 5:00، 20:00، 1:05:00 (أو بالدقايق: 5، 20، 65).",
          )
        : parsedCues.length === 0
          ? copy("Add at least one time.", "اكتب توقيت واحد على الأقل.")
          : null
      : null;
  const errors = breaks.flatMap(([key]) => {
    const value = draft[key].vastTagUrl ?? "";
    if (value && !isHttpsUrl(value)) return [key];
    if (draft.masterEnabled && draft[key].enabled && !value) return [key];
    return [];
  });
  const preview = previewCuePoints(
    { ...draft.midRoll, cuePointsSec: parsedCues ?? [] },
    previewMinutes * 60,
  );

  const testTag = async (key: string, tag: string | null) => {
    if (!tag || !isHttpsUrl(tag)) return;
    setChecks((current) => ({
      ...current,
      [key]: { tone: "info", text: copy("Testing…", "جاري الاختبار…") },
    }));
    const result = await checkVastTag(
      tag,
      key === "midRoll" ? "MID_ROLL" : key === "postRoll" ? "POST_ROLL" : "PRE_ROLL",
    );
    const text = {
      FILLED: copy(
        `Works: the tag returned ${result.ads} ad(s).`,
        `شغال: التاج رجّع ${result.ads} إعلان.`,
      ),
      NO_FILL: copy(
        "The tag answers correctly but has no ad right now (no fill). Normal while campaigns are not live yet.",
        "التاج بيرد صح بس مفيش إعلان متاح دلوقتي (No fill). ده طبيعي لو الحملات لسه مش شغالة.",
      ),
      AD_RULES: copy(
        "This is an ad-rules (VMAP) tag. Use a normal VAST tag here; the break times are set on this page.",
        "ده تاج Ad rules (VMAP). استخدم تاج VAST عادي هنا، لأن مواعيد الفواصل بتتحدد من الصفحة دي.",
      ),
      NOT_VAST: copy(
        "The address answered, but not with VAST. Check that you copied the video tag.",
        "الرابط رد بس مش بملف VAST. اتأكد إنك نسخت تاج الفيديو الصح.",
      ),
      UNREADABLE: copy(
        "The browser could not read the answer (the ad server does not allow it). This does not mean the tag is wrong — the player may still work. Check it in Ad Manager’s VAST inspector.",
        "المتصفح مقدرش يقرا الرد (سيرفر الإعلانات مش سامح بكده). ده مش معناه إن التاج غلط، والبلاير ممكن يشغّله عادي. تقدر تتأكد منه في VAST Inspector في Ad Manager.",
      ),
    }[result.status];
    const tone =
      result.status === "FILLED"
        ? "success"
        : result.status === "NO_FILL" || result.status === "UNREADABLE"
          ? "warning"
          : "danger";
    setChecks((current) => ({ ...current, [key]: { tone, text } }));
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Switch
          checked={draft.masterEnabled}
          onChange={(masterEnabled) => setDraft({ ...draft, masterEnabled })}
          label={copy("Video ads master switch", "المفتاح الرئيسي لإعلانات الفيديو")}
          hint={copy(
            "Ads play inside the AYIN player on the website (and in the apps if enabled in the App tab). Kids content never shows ads.",
            "الإعلانات بتشتغل جوه بلاير عين على الموقع (وجوه التطبيقات لو فعّلتها من تبويب التطبيق). محتوى الأطفال عمره ما بيظهر فيه إعلانات.",
          )}
        />
      </div>
      <StatusNotice tone="info" title={copy("Where to get the VAST tag", "منين تجيب تاج الـ VAST")}>
        {copy(
          "In Google Ad Manager: Inventory → Ad units → choose the video unit → Tags → Google IMA SDK → copy the tag URL. Use a normal VAST tag, not an ad-rules (VMAP) tag: the break times are set here. Placeholders like [placeholder] and [timestamp] are filled automatically for every video and every request.",
          "في Google Ad Manager: ‏Inventory ← Ad units ← اختار وحدة الفيديو ← Tags ← Google IMA SDK ← انسخ رابط التاج. استخدم تاج VAST عادي مش تاج Ad rules (VMAP)، لأن مواعيد الفواصل بتتحدد من هنا. الحاجات زي [placeholder] و[timestamp] بتتملي تلقائي لكل فيديو ولكل طلب.",
        )}
      </StatusNotice>
      <div className={styles.breaks}>
        {breaks.map(([key, label, hint]) => (
          <div key={key} className={styles.breakCard}>
            <Switch
              checked={draft[key].enabled}
              onChange={(enabled) => setDraft({ ...draft, [key]: { ...draft[key], enabled } })}
              label={label}
              hint={hint}
            />
            <label htmlFor={`vast-${key}`}>{copy("VAST tag URL", "رابط تاج VAST")}</label>
            <textarea
              id={`vast-${key}`}
              dir="ltr"
              rows={3}
              spellCheck={false}
              value={draft[key].vastTagUrl ?? ""}
              placeholder="https://pubads.g.doubleclick.net/gampad/ads?iu=/23374456398/AYIN/video&..."
              onChange={(event) => {
                setChecks((current) => ({ ...current, [key]: null }));
                setDraft({
                  ...draft,
                  [key]: {
                    ...draft[key],
                    vastTagUrl: extractVastTagUrl(event.target.value) || null,
                  },
                });
              }}
            />
            <div className={styles.inlineActions}>
              <ActionButton
                tone="secondary"
                type="button"
                disabled={!draft[key].vastTagUrl || !isHttpsUrl(draft[key].vastTagUrl ?? "")}
                onClick={() => void testTag(key, draft[key].vastTagUrl)}
              >
                {copy("Test tag", "اختبر التاج")}
              </ActionButton>
              {key === "preRoll" && draft.preRoll.vastTagUrl ? (
                <ActionButton
                  tone="quiet"
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      midRoll: {
                        ...draft.midRoll,
                        vastTagUrl: draft.midRoll.vastTagUrl ?? draft.preRoll.vastTagUrl,
                      },
                      postRoll: {
                        ...draft.postRoll,
                        vastTagUrl: draft.postRoll.vastTagUrl ?? draft.preRoll.vastTagUrl,
                      },
                    })
                  }
                >
                  {copy("Use this tag for empty breaks", "استخدم التاج ده للفواصل الفاضية")}
                </ActionButton>
              ) : null}
            </div>
            {checks[key] ? (
              <span className={styles.check} data-tone={checks[key]!.tone} role="status">
                {checks[key]!.text}
              </span>
            ) : null}
            {key === "midRoll" ? (
              <div className={styles.schedule}>
                <fieldset className={styles.choices}>
                  <legend>{copy("When do mid-rolls play?", "إمتى فواصل النص تشتغل؟")}</legend>
                  {(
                    [
                      ["INTERVAL", copy("Every few minutes", "كل كام دقيقة")],
                      ["CUE_POINTS", copy("At times I choose", "في توقيتات أحددها بنفسي")],
                    ] as const
                  ).map(([mode, modeLabel]) => (
                    <label
                      key={mode}
                      className={styles.choice}
                      data-selected={draft.midRoll.mode === mode ? "true" : undefined}
                    >
                      <input
                        type="radio"
                        name="mid-roll-mode"
                        checked={draft.midRoll.mode === mode}
                        onChange={() => setDraft({ ...draft, midRoll: { ...draft.midRoll, mode } })}
                      />
                      <span>
                        <strong>{modeLabel}</strong>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {draft.midRoll.mode === "INTERVAL" ? (
                  <label className={styles.inline}>
                    <span>{copy("Every (minutes)", "كل كام دقيقة")}</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      dir="ltr"
                      value={Math.round(draft.midRoll.everySec / 60)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          midRoll: {
                            ...draft.midRoll,
                            everySec: Math.max(
                              60,
                              Math.min(7200, Number(event.target.value || 1) * 60),
                            ),
                          },
                        })
                      }
                    />
                  </label>
                ) : (
                  <label className={styles.inline}>
                    <span>
                      {copy(
                        "Break times (from the start of the video)",
                        "توقيتات الفواصل (من بداية الفيديو)",
                      )}
                    </span>
                    <input
                      dir="ltr"
                      value={cueText}
                      placeholder="5:00, 20:00, 45:00"
                      onChange={(event) => setCueText(event.target.value)}
                    />
                  </label>
                )}
                {cueError ? <span className={styles.error}>{cueError}</span> : null}
                <label className={styles.inline}>
                  <span>
                    {copy("Maximum breaks in one video", "أقصى عدد فواصل في الفيديو الواحد")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    dir="ltr"
                    value={draft.midRoll.maxBreaks}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        midRoll: {
                          ...draft.midRoll,
                          maxBreaks: Math.max(1, Math.min(50, Number(event.target.value || 1))),
                        },
                      })
                    }
                  />
                </label>
                <div className={styles.preview}>
                  <label>
                    {copy("Preview for a video of", "معاينة لفيديو مدته")}{" "}
                    <input
                      type="number"
                      min={1}
                      max={600}
                      dir="ltr"
                      value={previewMinutes}
                      onChange={(event) =>
                        setPreviewMinutes(
                          Math.max(1, Math.min(600, Number(event.target.value || 1))),
                        )
                      }
                    />{" "}
                    {copy("minutes:", "دقيقة:")}
                  </label>
                  <p dir="ltr">
                    {preview.length
                      ? preview.map(formatClock).join("  ·  ")
                      : copy("no mid-roll in a video this short", "مفيش فواصل في فيديو بالطول ده")}
                  </p>
                  <small>
                    {copy(
                      "No break starts in the last 30 seconds. If a viewer skips over several breaks, only one plays. Resumed videos do not replay breaks they already passed.",
                      "مفيش فاصل بيبدأ في آخر 30 ثانية. لو المشاهد قفز فوق كذا فاصل، بيشوف إعلان واحد بس. ولو رجع يكمل فيديو، مش هيتعادله الفواصل اللي فاتت.",
                    )}
                  </small>
                </div>
              </div>
            ) : null}
            {errors.includes(key) ? (
              <span className={styles.error}>
                {copy("Paste a valid https VAST tag.", "الصق رابط VAST صحيح يبدأ بـ https.")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className={styles.field}>
        <label htmlFor="video-cap">
          {copy("Maximum ads per viewer session", "أقصى عدد إعلانات للمشاهد في الجلسة")}
        </label>
        <input
          id="video-cap"
          type="number"
          min={0}
          max={50}
          dir="ltr"
          value={draft.frequencyCapPerSession}
          onChange={(event) =>
            setDraft({
              ...draft,
              frequencyCapPerSession: Math.max(0, Math.min(50, Number(event.target.value || 0))),
            })
          }
        />
        <small>
          {copy(
            "Counts every ad a viewer sees across videos in one visit. 0 means no limit.",
            "بيعد كل إعلان المشاهد شافه في كل الفيديوهات خلال الزيارة الواحدة. 0 يعني من غير حد.",
          )}
        </small>
      </div>
      <div className={styles.formActions}>
        <ActionButton
          pending={busy === "video"}
          disabled={errors.length > 0 || Boolean(cueError)}
          onClick={() =>
            onSave({
              ...draft,
              midRoll: { ...draft.midRoll, cuePointsSec: parsedCues ?? [] },
            })
          }
        >
          {copy("Save video ads", "احفظ إعلانات الفيديو")}
        </ActionButton>
      </div>
    </section>
  );
}

function AppAds({
  copy,
  config,
  busy,
  onSave,
}: {
  copy: Copy;
  config: MobileConfig;
  busy: string | null;
  onSave: (config: MobileConfig) => void;
}) {
  const [draft, setDraft] = useState(config);
  const ads = draft.ads;
  const setAds = (next: Partial<MobileConfig["ads"]>) =>
    setDraft({ ...draft, ads: { ...ads, ...next } });
  const webView = draft.webViewAds ?? {
    android: { pageAdsEnabled: false, videoAdsEnabled: false },
    ios: { pageAdsEnabled: false, videoAdsEnabled: false },
  };
  const platformNames = { android: "Android", ios: "iPhone (iOS)" } as const;
  const unitInvalid = (value: string) => value !== "" && !mobileAdUnitProvider(value);
  const invalidUnits = (["android", "ios"] as const).some(
    (platform) =>
      unitInvalid(ads.platforms[platform].bannerUnitId) ||
      unitInvalid(ads.platforms[platform].interstitialUnitId),
  );
  const audienceMissing = ads.enabled && ads.audience !== "general";

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <Switch
          checked={ads.enabled}
          onChange={(enabled) => setAds({ enabled })}
          label={copy("App ads master switch", "المفتاح الرئيسي لإعلانات التطبيق")}
          hint={copy(
            "Native Google ads inside the Android and iPhone apps.",
            "إعلانات جوجل الأصلية جوه تطبيق أندرويد والآيفون.",
          )}
        />
        <Switch
          checked={ads.testMode}
          onChange={(testMode) => setAds({ testMode })}
          label={copy("Test mode", "وضع الاختبار")}
          hint={copy(
            "Shows Google's sample ads instead of your units. Turn it off when your units are approved.",
            "بيعرض إعلانات جوجل التجريبية بدل وحداتك. اقفله لما وحداتك تبقى جاهزة ومتوافق عليها.",
          )}
        />
        <label className={styles.inline}>
          <span>{copy("App audience", "جمهور التطبيق")}</span>
          <select
            value={ads.audience}
            onChange={(event) =>
              setAds({ audience: event.target.value as MobileConfig["ads"]["audience"] })
            }
          >
            <option value="unknown">{copy("Not declared", "مش محدد")}</option>
            <option value="general">{copy("General audience", "جمهور عام")}</option>
            <option value="children">{copy("Children", "أطفال")}</option>
          </select>
        </label>
        {audienceMissing ? (
          <span className={styles.error}>
            {copy(
              "Choose “General audience” to run app ads (child-directed app ads are not supported).",
              "اختار “جمهور عام” عشان تشغّل إعلانات التطبيق (إعلانات تطبيقات الأطفال مش مدعومة).",
            )}
          </span>
        ) : null}
      </div>

      <div className={styles.formatGrid}>
        <div className={styles.breakCard}>
          <Switch
            checked={ads.banner.enabled}
            onChange={(enabled) => setAds({ banner: { enabled } })}
            label={copy("Banner", "البانر (Banner)")}
            hint={copy(
              "A fixed banner at the bottom of Home, Search and channel screens.",
              "بانر ثابت أسفل شاشة الرئيسية والبحث وصفحات القنوات.",
            )}
          />
        </div>
        <div className={styles.breakCard}>
          <Switch
            checked={ads.interstitial.enabled}
            onChange={(enabled) => setAds({ interstitial: { ...ads.interstitial, enabled } })}
            label={copy("Full-screen (Interstitial)", "إعلان ملء الشاشة (Interstitial)")}
            hint={copy(
              "Shown while moving between Home, Search and channels — never during a video.",
              "بيظهر وانت بتتنقل بين الرئيسية والبحث والقنوات، وعمره ما بيظهر أثناء مشاهدة فيديو.",
            )}
          />
          <div className={styles.twoFields}>
            <label>
              <span>{copy("Wait between ads (seconds)", "الانتظار بين كل إعلان (ثانية)")}</span>
              <input
                type="number"
                dir="ltr"
                min={60}
                max={3600}
                value={ads.interstitial.cooldownSeconds}
                onChange={(event) =>
                  setAds({
                    interstitial: {
                      ...ads.interstitial,
                      cooldownSeconds: Math.max(
                        60,
                        Math.min(3600, Number(event.target.value || 60)),
                      ),
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{copy("Max per session", "أقصى عدد في الجلسة")}</span>
              <input
                type="number"
                dir="ltr"
                min={0}
                max={20}
                value={ads.interstitial.maxPerSession}
                onChange={(event) =>
                  setAds({
                    interstitial: {
                      ...ads.interstitial,
                      maxPerSession: Math.max(0, Math.min(20, Number(event.target.value || 0))),
                    },
                  })
                }
              />
            </label>
          </div>
        </div>
      </div>

      <StatusNotice
        tone="info"
        title={copy("Where to get the unit IDs", "منين تجيب أكواد الوحدات")}
      >
        {copy(
          "Google Ad Manager: Inventory → Ad units → create one unit per platform and format, then paste the path like /23374456398/AYIN/android_banner. AdMob IDs (ca-app-pub-…/…) also work.",
          "من Google Ad Manager: ‏Inventory ← Ad units ← اعمل وحدة لكل منصة ولكل نوع، والصق المسار بالشكل ‎/23374456398/AYIN/android_banner‎. أكواد AdMob ‏(ca-app-pub-…/…) بتشتغل برضه.",
        )}
      </StatusNotice>

      <div className={styles.formatGrid}>
        {(["android", "ios"] as const).map((platform) => {
          const unit = ads.platforms[platform];
          const setUnit = (next: Partial<typeof unit>) =>
            setAds({ platforms: { ...ads.platforms, [platform]: { ...unit, ...next } } });
          const setWebView = (next: Partial<(typeof webView)["android"]>) =>
            setDraft({
              ...draft,
              webViewAds: { ...webView, [platform]: { ...webView[platform], ...next } },
            });
          return (
            <div key={platform} className={styles.breakCard}>
              <Switch
                checked={unit.enabled}
                onChange={(enabled) => setUnit({ enabled })}
                label={platformNames[platform]}
                hint={copy("Native ads in this app.", "الإعلانات الأصلية في التطبيق ده.")}
              />
              <label htmlFor={`${platform}-banner`}>{copy("Banner unit", "وحدة البانر")}</label>
              <input
                id={`${platform}-banner`}
                dir="ltr"
                spellCheck={false}
                value={unit.bannerUnitId}
                placeholder={`/23374456398/AYIN/${platform}_banner`}
                onChange={(event) =>
                  setUnit({ bannerUnitId: extractAdUnitPath(event.target.value) })
                }
              />
              {unitInvalid(unit.bannerUnitId) ? (
                <span className={styles.error}>{copy("Invalid unit.", "الوحدة مش صحيحة.")}</span>
              ) : null}
              <label htmlFor={`${platform}-interstitial`}>
                {copy("Full-screen unit", "وحدة ملء الشاشة")}
              </label>
              <input
                id={`${platform}-interstitial`}
                dir="ltr"
                spellCheck={false}
                value={unit.interstitialUnitId}
                placeholder={`/23374456398/AYIN/${platform}_interstitial`}
                onChange={(event) =>
                  setUnit({ interstitialUnitId: extractAdUnitPath(event.target.value) })
                }
              />
              {unitInvalid(unit.interstitialUnitId) ? (
                <span className={styles.error}>{copy("Invalid unit.", "الوحدة مش صحيحة.")}</span>
              ) : null}
              <hr />
              <Switch
                checked={webView[platform].pageAdsEnabled}
                onChange={(pageAdsEnabled) => setWebView({ pageAdsEnabled })}
                label={copy("Website ads inside the app", "إعلانات الموقع جوه التطبيق")}
                hint={copy(
                  "Shows the website slots (Website tab) inside this app's WebView.",
                  "بيعرض أماكن إعلانات الموقع (تبويب الموقع) جوه الـ WebView في التطبيق ده.",
                )}
              />
              <Switch
                checked={webView[platform].videoAdsEnabled}
                onChange={(videoAdsEnabled) => setWebView({ videoAdsEnabled })}
                label={copy("Video ads inside the app", "إعلانات الفيديو جوه التطبيق")}
                hint={copy(
                  "Plays the VAST video ads (Video tab) in this app's player.",
                  "بيشغّل إعلانات الفيديو VAST (تبويب الفيديو) في بلاير التطبيق ده.",
                )}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.formActions}>
        <ActionButton
          pending={busy === "app"}
          disabled={invalidUnits || audienceMissing}
          onClick={() => onSave(draft)}
        >
          {copy("Save app ads", "احفظ إعلانات التطبيق")}
        </ActionButton>
      </div>
    </section>
  );
}
