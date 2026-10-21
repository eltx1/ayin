"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminAccess } from "./admin-access";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, PageHeader, StatusNotice } from "@/components/ui/design-system";
import { readAdminApiError } from "@/lib/admin-reauthentication";
import { apiBaseUrl } from "@/lib/api";
import {
  parseMobileConfig,
  mobileAdUnitProvider,
  notificationTypes,
  type MobileConfig,
} from "@/lib/mobile-config";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";
import styles from "./admin-mobile.module.css";
export function AdminMobile() {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const { getScopeLease, subscribeScopeInvalidation } = useAdminAccess();
  const [config, setConfig] = useState<MobileConfig | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [reason, setReason] = useState(""),
    [status, setStatus] = useState<unknown>(null),
    [deliveries, setDeliveries] = useState<unknown>(null);
  const [accountId, setAccountId] = useState(""),
    [installationId, setInstallationId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [type, setType] = useState("system"),
    [kind, setKind] = useState("notifications"),
    [destinationId, setDestinationId] = useState("");
  const pending = useRef(false),
    active = useRef<AbortController | null>(null),
    privateBody = useRef<HTMLDivElement>(null),
    dedupe = useRef<string | null>(null);
  useEffect(
    () =>
      subscribeScopeInvalidation(() => {
        if (privateBody.current) privateBody.current.hidden = true;
        active.current?.abort();
        pending.current = false;
        setConfig(null);
        setStatus(null);
        setDeliveries(null);
        setAccountId("");
        setInstallationId("");
        setTitle("");
        setBody("");
        setReason("");
        setMessage("");
        setBusy(false);
      }),
    [subscribeScopeInvalidation],
  );
  useEffect(() => () => active.current?.abort(), []);
  async function run(
    operation: (
      request: (path: string, method?: string, payload?: unknown) => Promise<unknown>,
    ) => Promise<void>,
  ) {
    const lease = getScopeLease();
    if (pending.current || !lease || !lease.session.roles.some((role) => role === "SUPERADMIN"))
      return;
    const controller = new AbortController();
    active.current = controller;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const request = async (path: string, method = "GET", payload?: unknown) => {
      if (lease !== getScopeLease()) throw new Error("ADMIN_CHANGED");
      const response = await fetch(apiBaseUrl + path, {
        method,
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-ayin-expected-account": lease.session.accountId,
          "x-ayin-expected-session": lease.session.sessionId,
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) await readAdminApiError(response);
      if (controller.signal.aborted || lease !== getScopeLease() || !response.ok)
        throw new Error("REQUEST_UNCONFIRMED");
      return response.json();
    };
    try {
      await operation(request);
      if (privateBody.current && lease === getScopeLease()) privateBody.current.hidden = false;
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          copy(
            "Request not confirmed. Read current settings before retrying. Check your access and reauthentication status.",
            "لم يتم تأكيد الطلب. اقرأ الإعدادات الحالية قبل إعادة المحاولة وراجع صلاحياتك وإعادة المصادقة.",
          ),
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const load = () =>
    run(async (request) => {
      const next = parseMobileConfig(await request("/admin/mobile/config"));
      setConfig(next);
      setStatus(await request("/admin/mobile/status"));
    });
  const invalidAdUnits = config
    ? Object.values(config.ads.platforms).some((platform) =>
        [platform.bannerUnitId, platform.interstitialUnitId].some(
          (unit) => unit !== "" && !mobileAdUnitProvider(unit),
        ),
      )
    : false;
  const save = () =>
    run(async (request) => {
      if (!config || reason.trim().length < 4) throw new Error("REASON_REQUIRED");
      const value = parseMobileConfig(config);
      await request("/admin/mobile/config", "PUT", { config: value, reason: reason.trim() });
      const verified = parseMobileConfig(await request("/admin/mobile/config"));
      setConfig(verified);
      setMessage(
        copy(
          "Configuration saved and read back.",
          "حُفظت الإعدادات وتحقّقنا منها بقراءتها مجددًا.",
        ),
      );
    });
  const push = () =>
    run(async (request) => {
      if (reason.trim().length < 4) throw new Error("REASON_REQUIRED");
      dedupe.current ??= crypto.randomUUID();
      await request("/admin/mobile/push", "POST", {
        accountId,
        ...(installationId ? { installationId } : {}),
        dedupeKey: dedupe.current,
        title,
        body,
        type,
        destination: { kind, ...(kind !== "notifications" ? { id: destinationId } : {}) },
        reason: reason.trim(),
      });
      dedupe.current = null;
      setMessage(
        copy(
          "Targeted notification accepted. Delivery must be checked on the selected device.",
          "قُبل الإشعار الموجّه. يجب التحقق من وصوله على الجهاز المحدد.",
        ),
      );
      setDeliveries(
        await request("/admin/mobile/deliveries?accountId=" + encodeURIComponent(accountId)),
      );
    });
  const patch = (change: Partial<MobileConfig>) => config && setConfig({ ...config, ...change });
  return (
    <div className={styles.page}>
      <PageHeader
        title={copy("Mobile app", "تطبيق الموبايل")}
        description={copy(
          "Manage existing app capabilities and send notifications to one verified account. Native SDK changes require a store release.",
          "إدارة قدرات التطبيق الموجودة وإرسال إشعار لحساب محدد. تحديث مكتبات التطبيق الأصلية يحتاج إصدار متجر.",
        )}
      />
      <AdminAdvertisingNavigation current="mobile" />
      <ActionButton disabled={busy} onClick={() => void load()}>
        {copy("Read settings and readiness", "قراءة الإعدادات والجاهزية")}
      </ActionButton>
      {message && <StatusNotice announce="polite">{message}</StatusNotice>}
      <div ref={privateBody}>
        {config && (
          <>
            <section>
              <h2>{copy("Advertising and analytics", "الإعلانات والتحليلات")}</h2>
              <p>
                {copy(
                  "Google Ad Manager app inventory uses /network_code/ad_unit. AdMob uses ca-app-pub-…/…. Paste the complete app unit below; the provider is detected automatically. Web GPT tags and VAST URLs are not supported here.",
                  "وحدات تطبيقات Google Ad Manager تُكتب /network_code/ad_unit. وحدات AdMob تُكتب ca-app-pub-…/…. أدخل مسار وحدة التطبيق كاملًا؛ يُحدَّد المزود تلقائيًا. هذه الحقول لا تقبل أكواد GPT أو روابط VAST الخاصة بالويب.",
                )}
              </p>
              <p>
                {copy(
                  "Banner: bottom of home, search and channel browsing pages. Interstitial: optional between browsing pages only; never during video, Clips or upload. Google Ad Manager requires an updated native app. Saving settings cannot add this SDK capability to an older build.",
                  "البانر: أسفل صفحات الرئيسية والبحث والقنوات. الإعلان البيني: اختياري عند التنقل بين صفحات التصفح فقط، وليس أثناء الفيديو أو Clips أو الرفع. Google Ad Manager يحتاج نسخة تطبيق أصلية محدثة؛ حفظ الإعدادات لا يضيف هذه القدرة لنسخة قديمة.",
                )}
              </p>
              <p role="status">
                {!config.ads.enabled
                  ? copy(
                      "App ads are OFF. Enable the global switch, the platform and a format to begin testing.",
                      "إعلانات التطبيق متوقفة. لبدء الاختبار فعّل المفتاح العام والمنصة ونوع الإعلان.",
                    )
                  : config.ads.audience !== "general"
                    ? copy(
                        "Ads are blocked until a supported audience is declared.",
                        "الإعلانات محجوبة حتى تحديد جمهور مدعوم.",
                      )
                    : copy(
                        "Delivery still requires app configuration, adult affirmation and privacy consent on the device. A saved unit does not prove ad delivery.",
                        "ظهور الإعلان يحتاج أيضًا إعداد التطبيق وإقرار العمر وموافقة الخصوصية على الجهاز. حفظ الوحدة لا يثبت وصول إعلان.",
                      )}
              </p>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.ads.enabled}
                  onChange={(e) => patch({ ads: { ...config.ads, enabled: e.target.checked } })}
                />{" "}
                {copy("Enable app ads", "تفعيل إعلانات التطبيق")}
              </label>
              <br />
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.ads.testMode}
                  onChange={(e) => patch({ ads: { ...config.ads, testMode: e.target.checked } })}
                />{" "}
                {copy("Test ads only", "إعلانات اختبار فقط")}
              </label>
              <br />
              <label>
                {copy("Declared audience", "الجمهور المعلن")}{" "}
                <select
                  disabled={busy}
                  value={config.ads.audience}
                  onChange={(e) =>
                    patch({
                      ads: {
                        ...config.ads,
                        audience: e.target.value as MobileConfig["ads"]["audience"],
                      },
                    })
                  }
                >
                  <option value="unknown">
                    {copy("Not configured — ads blocked", "غير محدد — الإعلانات معطلة")}
                  </option>
                  <option value="general">{copy("General audience", "جمهور عام")}</option>
                  <option value="children">
                    {copy(
                      "Children — review privacy requirements",
                      "أطفال — مراجعة متطلبات الخصوصية",
                    )}
                  </option>
                </select>
              </label>
              <br />
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.ads.banner.enabled}
                  onChange={(e) =>
                    patch({ ads: { ...config.ads, banner: { enabled: e.target.checked } } })
                  }
                />{" "}
                Adaptive banner
              </label>
              <br />
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.ads.interstitial.enabled}
                  onChange={(e) =>
                    patch({
                      ads: {
                        ...config.ads,
                        interstitial: { ...config.ads.interstitial, enabled: e.target.checked },
                      },
                    })
                  }
                />{" "}
                {copy(
                  "Interstitial between browsing pages",
                  "إعلان بيني عند التنقل بين صفحات التصفح",
                )}
              </label>
              {(["android", "ios"] as const).map((platform) => (
                <fieldset key={platform} disabled={busy}>
                  <legend>{platform === "android" ? "Android" : "iOS"}</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={config.ads.platforms[platform].enabled}
                      onChange={(e) =>
                        patch({
                          ads: {
                            ...config.ads,
                            platforms: {
                              ...config.ads.platforms,
                              [platform]: {
                                ...config.ads.platforms[platform],
                                enabled: e.target.checked,
                              },
                            },
                          },
                        })
                      }
                    />{" "}
                    {copy("Enable ads on this platform", "تفعيل إعلانات هذه المنصة")}
                  </label>
                  {(["bannerUnitId", "interstitialUnitId"] as const).map((key) => (
                    <label key={key} style={{ display: "block" }}>
                      {key === "bannerUnitId"
                        ? copy("Banner ad unit", "وحدة إعلان البانر")
                        : copy("Interstitial ad unit", "وحدة الإعلان البيني")}{" "}
                      <input
                        aria-label={`${platform} ${key}`}
                        maxLength={256}
                        dir="ltr"
                        value={config.ads.platforms[platform][key]}
                        onChange={(e) =>
                          patch({
                            ads: {
                              ...config.ads,
                              platforms: {
                                ...config.ads.platforms,
                                [platform]: {
                                  ...config.ads.platforms[platform],
                                  [key]: e.target.value,
                                },
                              },
                            },
                          })
                        }
                        placeholder="/network_code/app_ad_unit أو ca-app-pub-…/…"
                      />
                      <span>
                        {mobileAdUnitProvider(config.ads.platforms[platform][key]) === "gam"
                          ? "Google Ad Manager"
                          : mobileAdUnitProvider(config.ads.platforms[platform][key]) === "admob"
                            ? "AdMob"
                            : config.ads.platforms[platform][key]
                              ? copy("Invalid unit format", "صيغة الوحدة غير صحيحة")
                              : copy("No unit set", "لم تُضبط وحدة")}
                      </span>
                    </label>
                  ))}
                  <ActionButton
                    type="button"
                    tone="secondary"
                    onClick={() =>
                      patch({
                        ads: {
                          ...config.ads,
                          testMode: true,
                          platforms: {
                            ...config.ads.platforms,
                            [platform]: {
                              ...config.ads.platforms[platform],
                              bannerUnitId: "/21775744923/example/adaptive-banner",
                              interstitialUnitId: "/21775744923/example/interstitial",
                            },
                          },
                        },
                      })
                    }
                  >
                    {copy(
                      `Use Google Ad Manager test units (${platform})`,
                      `استخدام وحدات Google Ad Manager التجريبية (${platform})`,
                    )}
                  </ActionButton>
                  <p>
                    {copy(
                      "This fills test units and switches test mode on. It does not enable ads or save until you submit the form.",
                      "يملأ الزر وحدات الاختبار ويفعّل وضع الاختبار. لا يفعّل الإعلانات ولا يحفظ التغييرات قبل الضغط على حفظ.",
                    )}
                  </p>
                </fieldset>
              ))}
              {(["cooldownSeconds", "maxPerSession"] as const).map((key) => (
                <label key={key} style={{ display: "block" }}>
                  {key}{" "}
                  <input
                    type="number"
                    disabled={busy}
                    value={config.ads.interstitial[key]}
                    min={key === "cooldownSeconds" ? 60 : 0}
                    max={key === "cooldownSeconds" ? 3600 : 20}
                    onChange={(e) =>
                      patch({
                        ads: {
                          ...config.ads,
                          interstitial: {
                            ...config.ads.interstitial,
                            [key]: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
              ))}
              {(["requestTimeoutMs", "retryCount", "retryBackoffMs"] as const).map((key) => (
                <label key={key} style={{ display: "block" }}>
                  {key}{" "}
                  <input
                    type="number"
                    disabled={busy}
                    value={config.ads[key]}
                    min={key === "retryCount" ? 0 : key === "requestTimeoutMs" ? 1000 : 500}
                    max={key === "retryCount" ? 3 : 30000}
                    onChange={(e) =>
                      patch({ ads: { ...config.ads, [key]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.analytics.enabled}
                  onChange={(e) => patch({ analytics: { enabled: e.target.checked } })}
                />{" "}
                {copy(
                  "Permit optional analytics (requires user consent)",
                  "إتاحة التحليلات الاختيارية (تتطلب موافقة المستخدم)",
                )}
              </label>
            </section>
            <section>
              <h2>
                {copy("Notifications and supported versions", "الإشعارات والإصدارات المدعومة")}
              </h2>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={config.notifications.enabled}
                  onChange={(e) =>
                    patch({ notifications: { ...config.notifications, enabled: e.target.checked } })
                  }
                />{" "}
                {copy("Enable notifications", "تفعيل الإشعارات")}
              </label>
              {(["android", "ios"] as const).map((platform) => (
                <fieldset key={platform} disabled={busy}>
                  <legend>{platform === "android" ? "Android" : "iOS"}</legend>
                  {(["minimumAppVersion", "latestAppVersion"] as const).map((key) => (
                    <label key={key}>
                      {key}{" "}
                      <input
                        dir="ltr"
                        value={config[key][platform]}
                        pattern="[0-9]+\.[0-9]+\.[0-9]+"
                        onChange={(e) =>
                          patch({ [key]: { ...config[key], [platform]: e.target.value } })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              ))}
              <p>
                {copy(
                  "The hosted web interface follows web deployments. No downloaded native code or bundle updater is enabled.",
                  "الواجهة المستضافة تتبع نشر الويب. تنزيل كود أصلي أو تحديث حزم منفصل غير مفعّل.",
                )}
              </p>
            </section>
            <label>
              {copy("Reason for the change / notification", "سبب التغيير / الإشعار")}{" "}
              <input
                disabled={busy}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>{" "}
            <ActionButton
              disabled={busy || invalidAdUnits || reason.trim().length < 4}
              onClick={() => void save()}
            >
              {copy("Save configuration", "حفظ الإعدادات")}
            </ActionButton>
            <details>
              <summary>{copy("Service readiness", "جاهزية الخدمات")}</summary>
              <pre dir="ltr" style={{ overflow: "auto" }}>
                {JSON.stringify(status, null, 2)}
              </pre>
            </details>
            <section>
              <h2>{copy("Targeted test notification", "إشعار اختبار موجّه")}</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void push();
                }}
              >
                <fieldset disabled={busy}>
                  <label>
                    Account ID{" "}
                    <input
                      required
                      dir="ltr"
                      value={accountId}
                      pattern="[0-9a-fA-F-]{36}"
                      onChange={(e) => {
                        setAccountId(e.target.value);
                        dedupe.current = null;
                      }}
                    />
                  </label>
                  <br />
                  <label>
                    {copy("Installation ID (optional)", "معرّف التثبيت (اختياري)")}{" "}
                    <input
                      dir="ltr"
                      value={installationId}
                      pattern="[0-9a-fA-F-]{36}"
                      onChange={(e) => setInstallationId(e.target.value)}
                    />
                  </label>
                  <br />
                  <label>
                    {copy("Title", "العنوان")}{" "}
                    <input
                      required
                      value={title}
                      maxLength={100}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <br />
                  <label>
                    {copy("Message", "الرسالة")}{" "}
                    <textarea
                      required
                      value={body}
                      maxLength={240}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </label>
                  <br />
                  <label>
                    {copy("Type", "النوع")}{" "}
                    <select value={type} onChange={(e) => setType(e.target.value)}>
                      {notificationTypes.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>{" "}
                  <label>
                    {copy("Destination", "الوجهة")}{" "}
                    <select value={kind} onChange={(e) => setKind(e.target.value)}>
                      <option value="notifications">notifications</option>
                      <option value="video">video</option>
                      <option value="channel">channel</option>
                    </select>
                  </label>
                  <br />
                  {kind !== "notifications" && (
                    <label>
                      Destination ID{" "}
                      <input
                        required
                        dir="ltr"
                        value={destinationId}
                        pattern="[0-9a-fA-F-]{36}"
                        onChange={(e) => setDestinationId(e.target.value)}
                      />
                    </label>
                  )}
                  <ActionButton type="submit" disabled={reason.trim().length < 4}>
                    {copy("Send to this account", "الإرسال لهذا الحساب")}
                  </ActionButton>
                  <ActionButton
                    type="button"
                    tone="secondary"
                    disabled={!/^[0-9a-f-]{36}$/i.test(accountId)}
                    onClick={() =>
                      void run(async (request) =>
                        setDeliveries(
                          await request(
                            "/admin/mobile/deliveries?accountId=" + encodeURIComponent(accountId),
                          ),
                        ),
                      )
                    }
                  >
                    {copy("Read delivery log", "قراءة سجل الإرسال")}
                  </ActionButton>
                </fieldset>
              </form>
              {deliveries !== null && (
                <pre dir="ltr" style={{ overflow: "auto" }}>
                  {JSON.stringify(deliveries, null, 2)}
                </pre>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
