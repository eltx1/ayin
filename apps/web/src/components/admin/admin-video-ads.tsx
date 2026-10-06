"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  PageHeader,
  StatusNotice,
  TextField,
  SelectField,
  FormSection,
  DataBadge,
} from "@/components/ui/design-system";
import { Disclosure } from "@/components/ui/data-presentation";
import type { AdminSession } from "@/lib/admin-control";
import {
  AdminVideoAdError,
  getVideoAdWorkspace,
  reviewVideoAdTarget,
  reviewVideoAdSettings,
  searchVideoAdTargets,
  saveVideoAdCommand,
  videoAdValues,
  type AdTarget,
  type VideoAdSettings,
  type VideoAdSettingsRecord,
  type VideoAdValues,
  type VideoAdTargetRecord,
  type VideoAdFilters,
  type VideoAdAck,
  type VideoAdCommand,
} from "@/lib/admin-video-ad-workspace";
import styles from "./admin-record-workspace.module.css";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";
type Snapshot = Awaited<ReturnType<typeof getVideoAdWorkspace>>;
type Matches = Awaited<ReturnType<typeof searchVideoAdTargets>>;
type Recovery = { kind: "SETTINGS" } | AdTarget;
const keyOf = (t: AdTarget) => t.kind + ":" + t.id;
export function AdminVideoAds({ initialQuery = "" }: { initialQuery?: string }) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [filters, setFilters] = useState<VideoAdFilters>({
    page: 1,
    query: initialQuery.slice(0, 200),
    targetType: "",
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [settingsOriginal, setSettingsOriginal] = useState<VideoAdSettingsRecord | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Partial<VideoAdSettings>>({}),
    [drafts, setDrafts] = useState<Record<string, Partial<VideoAdValues>>>({});
  const [selected, setSelected] = useState<VideoAdTargetRecord | null>(null),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<Matches | null>(null);
  const [ack, setAck] = useState<VideoAdAck | null>(null),
    [recovery, setRecovery] = useState<Recovery | null>(null),
    [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false),
    [authorized, setAuthorized] = useState(false),
    [locked, setLocked] = useState(false),
    [generation, setGeneration] = useState(0);
  const [error, setError] = useState<
    "read" | "denied" | "invalid" | "uncertain" | "verification" | null
  >(null);
  const actor = useRef<AdminSession | null>(null),
    selectedTarget = useRef<AdTarget | null>(null),
    operation = useRef(false),
    lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    body = useRef<HTMLDivElement | null>(null),
    dirty = useRef(false),
    initial = useRef(filters);
  const clearActor = useCallback(() => {
    if (body.current) body.current.hidden = true;
    actor.current = null;
    setAuthorized(false);
    selectedTarget.current = null;
    setFilters({ page: 1, query: "", targetType: "" });
    setSnapshot(null);
    setSettingsOriginal(null);
    setSettingsDraft({});
    setDrafts({});
    setSelected(null);
    setQuery("");
    setMatches(null);
    setAck(null);
    setRecovery(null);
    setReviewed(false);
    lock.current = true;
    setLocked(true);
    setError("denied");
  }, []);
  const load = useCallback(
    async (input: VideoAdFilters) => {
      if (operation.current) return;
      operation.current = true;
      const pending = new AbortController();
      controller.current = pending;
      setBusy(true);
      setError(null);
      setSnapshot(null);
      try {
        const result = await getVideoAdWorkspace(input, pending.signal, actor.current ?? undefined);
        if (pending.signal.aborted) return;
        if (body.current?.hidden) setGeneration((x) => x + 1);
        actor.current = result.actor;
        setAuthorized(true);
        setRecovery((current) => (lock.current ? (current ?? { kind: "SETTINGS" }) : current));
        setSnapshot(result);
        setSettingsOriginal(result.settings);
        setFilters(input);
      } catch (e) {
        if (!pending.signal.aborted) {
          if (e instanceof AdminVideoAdError && [401, 403].includes(e.status)) clearActor();
          else setError("read");
        }
      } finally {
        if (controller.current === pending) {
          controller.current = null;
          operation.current = false;
          setBusy(false);
        }
      }
    },
    [clearActor],
  );
  useEffect(() => {
    selectedTarget.current = selected ? { kind: selected.kind, id: selected.target.id } : null;
  }, [selected]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load(initial.current);
    });
    const hide = () => {
      const capturedTarget = selectedTarget.current;
      const pending = controller.current;
      controller.current = null;
      operation.current = false;
      pending?.abort();
      if (body.current) body.current.hidden = true;
      setAuthorized(false);
      lock.current = true;
      setLocked(true);
      setRecovery((current) => current ?? capturedTarget ?? { kind: "SETTINGS" });
      setReviewed(false);
      setSnapshot(null);
      setSettingsOriginal(null);
      setSelected(null);
      setMatches(null);
      setBusy(false);
      setError("read");
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      controller.current?.abort();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load]);
  useEffect(() => {
    dirty.current =
      busy ||
      locked ||
      Object.keys(settingsDraft).length > 0 ||
      Object.values(drafts).some((x) => Object.keys(x).length > 0);
  }, [busy, locked, settingsDraft, drafts]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const navigate = (e: MouseEvent) => {
      if (
        !dirty.current ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const anchor =
        e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.href === location.href
      )
        return;
      if (
        !window.confirm(
          ar
            ? "لديك تعديلات أو عملية تحتاج للمراجعة. هل تريد المغادرة؟"
            : "You have edits or an operation awaiting review. Leave this page?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [ar]);
  async function read<T>(
    fn: (a: AdminSession, s: AbortSignal) => Promise<T>,
    accept: (value: T) => void,
  ) {
    if (operation.current || !actor.current) return;
    operation.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError(null);
    try {
      const result = await fn(actor.current, pending.signal);
      if (!pending.signal.aborted) {
        setAuthorized(true);
        if (body.current?.hidden) setGeneration((x) => x + 1);
        accept(result);
      }
    } catch (e) {
      if (!pending.signal.aborted) {
        if (e instanceof AdminVideoAdError && [401, 403].includes(e.status)) clearActor();
        else setError("read");
      }
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  function choose(target: AdTarget) {
    if (lock.current) return;
    void read(
      (a, s) => reviewVideoAdTarget(a, target, s),
      (value) => {
        setSelected(value);
        if (!value) setError("read");
      },
    );
  }
  async function save(command: VideoAdCommand) {
    if (operation.current || lock.current || !actor.current) return;
    operation.current = true;
    lock.current = true;
    dirty.current = true;
    setLocked(true);
    setBusy(true);
    setReviewed(false);
    setError(null);
    const captured: Recovery =
      command.kind === "SETTINGS"
        ? { kind: "SETTINGS" }
        : { kind: command.original.kind, id: command.original.target.id };
    setRecovery(captured);
    const pending = new AbortController();
    controller.current = pending;
    try {
      const result = await saveVideoAdCommand(actor.current, command, pending.signal);
      if (pending.signal.aborted) return;
      setAck(result);
      if (result.kind === "SETTINGS") {
        setSettingsDraft({});
        setSettingsOriginal(result.record);
      } else {
        setDrafts((current) => ({ ...current, [keyOf(result.target)]: {} }));
        setSelected((current) =>
          current && keyOf({ kind: current.kind, id: current.target.id }) === keyOf(result.target)
            ? { ...current, override: result.kind === "OVERRIDE" ? result.record : null }
            : current,
        );
      }
    } catch (e) {
      if (pending.signal.aborted) return;
      if (e instanceof AdminVideoAdError && e.verificationRequired) {
        lock.current = false;
        setLocked(false);
        setRecovery(null);
        setError("verification");
      } else if (e instanceof AdminVideoAdError && [401, 403].includes(e.status)) clearActor();
      else if (e instanceof AdminVideoAdError && !e.writeStarted) {
        lock.current = false;
        setLocked(false);
        setRecovery(null);
        setError("invalid");
      } else setError("uncertain");
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  function review() {
    if (!recovery) return;
    setReviewed(false);
    if (recovery.kind === "SETTINGS")
      void read(reviewVideoAdSettings, (result) => {
        setSettingsOriginal(result);
        setReviewed(true);
      });
    else {
      const target = recovery;
      void read(
        (a, s) => reviewVideoAdTarget(a, target, s),
        (result) => {
          setSelected(result);
          setReviewed(true);
        },
      );
    }
  }
  const settings = settingsOriginal ? { ...settingsOriginal.settings, ...settingsDraft } : null;
  const unappliedFilters = Boolean(
    snapshot &&
    (filters.query.trim() !== snapshot.filters.query.trim() ||
      filters.targetType !== snapshot.filters.targetType),
  );
  const selectedKey = selected ? keyOf({ kind: selected.kind, id: selected.target.id }) : null;
  const values = selected
    ? { ...videoAdValues(selected.override), ...(selectedKey ? drafts[selectedKey] : {}) }
    : null;
  function editSettings<K extends keyof VideoAdSettings>(key: K, value: VideoAdSettings[K]) {
    if (busy || lock.current || !settingsOriginal) return;
    dirty.current = true;
    setSettingsDraft((current) => {
      const next = { ...current };
      if (value === settingsOriginal.settings[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  }
  function editOverride<K extends keyof VideoAdValues>(key: K, value: VideoAdValues[K]) {
    if (busy || lock.current || !selected || !selectedKey) return;
    dirty.current = true;
    const original = videoAdValues(selected.override);
    setDrafts((current) => {
      const next = { ...current[selectedKey] };
      if (value === original[key]) delete next[key];
      else next[key] = value;
      return { ...current, [selectedKey]: next };
    });
  }
  const errors = {
    read: copy(
      "Records could not be verified. Use an explicit read to recover.",
      "تعذّر التحقق من السجلات. استخدم قراءة صريحة للاستعادة.",
    ),
    denied: copy(
      "Advertising authority changed. Private facts and drafts were cleared.",
      "تغيّرت صلاحيات الإعلانات. أُزيلت البيانات الخاصة والمسودات.",
    ),
    invalid: copy(
      "Check the edited fields; no command was sent.",
      "راجع الحقول المعدلة؛ لم يُرسل أي أمر.",
    ),
    uncertain: copy(
      "The result is uncertain. Read the original configuration before reviewing another command.",
      "النتيجة غير مؤكدة. اقرأ الإعدادات الأصلية قبل مراجعة أمر جديد.",
    ),
    verification: copy(
      "Verification was canceled. Your edits are retained; submit only after explicit verification.",
      "أُلغي التحقق. تعديلاتك محفوظة؛ أرسلها بعد التحقق الصريح فقط.",
    ),
  };
  return (
    <div className={styles.workspace}>
      <PageHeader
        eyebrow={copy("Advertising", "الإعلانات")}
        title={copy("Video advertising", "إعلانات الفيديو")}
        description={copy(
          "Review player defaults and actual channel or video exceptions.",
          "راجع إعدادات المشغّل الافتراضية والاستثناءات الفعلية للقنوات والفيديوهات.",
        )}
        actions={
          <ActionButton disabled={busy} onClick={() => void load(filters)}>
            {copy("Read advertising records", "قراءة سجلات الإعلانات")}
          </ActionButton>
        }
      />
      <AdminAdvertisingNavigation current="video" />
      {error && <StatusNotice tone="danger">{errors[error]}</StatusNotice>}
      <div
        ref={body}
        className={styles.privateBody}
        key={generation}
        data-testid="video-ads-private-body"
      >
        {ack && (
          <StatusNotice
            tone="success"
            title={copy(
              "The submitted change was acknowledged and audited.",
              "تم تأكيد التعديل المُرسل وتسجيله.",
            )}
          >
            <div data-testid="video-ads-ack">
              {ack.kind === "SETTINGS"
                ? copy("Player defaults saved", "حُفظت إعدادات المشغّل")
                : ack.kind === "DELETE"
                  ? copy("Override removed", "أُزيل الاستثناء")
                  : copy("Override saved", "حُفظ الاستثناء")}
            </div>
          </StatusNotice>
        )}
        {locked && authorized && (
          <FormSection
            id="video-ads-recovery"
            legend={copy("Review the original configuration", "مراجعة الإعدادات الأصلية")}
          >
            <p>
              {copy(
                "Automatic retries are disabled. Read the original target, keep your edits and explicitly review the next command.",
                "إعادة المحاولة التلقائية معطّلة. اقرأ الهدف الأصلي، واحتفظ بتعديلاتك، ثم راجع الأمر التالي صراحةً.",
              )}
            </p>
            <ActionButton disabled={busy || !recovery} onClick={review}>
              {copy("Read original configuration", "قراءة الإعدادات الأصلية")}
            </ActionButton>
            {reviewed && (
              <p data-testid="video-ads-reviewed">
                {recovery?.kind !== "SETTINGS" && !selected
                  ? copy("The original target no longer exists.", "الهدف الأصلي لم يعد موجودًا.")
                  : copy(
                      "Current original configuration verified.",
                      "تم التحقق من الإعدادات الأصلية الحالية.",
                    )}
              </p>
            )}
            <ActionButton
              disabled={busy || !reviewed}
              onClick={() => {
                lock.current = false;
                setLocked(false);
                setRecovery(null);
                setReviewed(false);
              }}
            >
              {copy("Review retained edits", "مراجعة التعديلات المحفوظة")}
            </ActionButton>
          </FormSection>
        )}
        {settings && (
          <Disclosure
            summary={copy("Review and edit player defaults", "مراجعة إعدادات المشغّل وتعديلها")}
          >
            <FormSection
              id="video-ads-settings"
              legend={copy("Player defaults", "إعدادات المشغّل الافتراضية")}
            >
              <DataBadge>
                {settingsOriginal?.source === "DEFAULT"
                  ? copy("Default; not stored", "افتراضي؛ غير محفوظ")
                  : settingsOriginal?.source === "INVALID_STORED_DEFAULT"
                    ? copy(
                        "Invalid stored configuration; defaults shown",
                        "إعدادات محفوظة غير صالحة؛ تظهر القيم الافتراضية",
                      )
                    : copy("Stored configuration", "إعدادات محفوظة")}
              </DataBadge>
              <p>
                {copy(
                  "Provider: Google IMA. Configuration alone does not certify consent or provider readiness.",
                  "المزوّد: Google IMA. حفظ الإعدادات وحده لا يثبت جاهزية المزوّد أو الموافقة.",
                )}
              </p>
              {(
                [
                  ["masterEnabled", "Video ads enabled", "إعلانات الفيديو مفعّلة"],
                  ["preRollEnabled", "Pre-roll", "قبل الفيديو"],
                  ["midRollEnabled", "Mid-roll", "أثناء الفيديو"],
                  ["postRollEnabled", "Post-roll", "بعد الفيديو"],
                ] as const
              ).map(([key, en, arabic]) => (
                <label className={styles.choice} key={key}>
                  <input
                    type="checkbox"
                    disabled={busy || locked}
                    checked={settings[key]}
                    onChange={(e) => editSettings(key, e.target.checked)}
                  />
                  {copy(en, arabic)}
                </label>
              ))}
              <TextField
                id="video-ads-interval"
                label={copy("Mid-roll interval (seconds)", "الفاصل بين الإعلانات (ثوانٍ)")}
                type="number"
                min={60}
                max={7200}
                disabled={busy || locked}
                value={
                  Number.isNaN(settings.midRollEverySec) ? "" : String(settings.midRollEverySec)
                }
                onChange={(e) =>
                  editSettings(
                    "midRollEverySec",
                    e.target.value === "" ? NaN : Number(e.target.value),
                  )
                }
              />
              <TextField
                id="video-ads-frequency"
                label={copy(
                  "Session frequency cap (0 = unlimited)",
                  "حد الإعلانات للجلسة (٠ = بلا حد)",
                )}
                type="number"
                min={0}
                max={50}
                disabled={busy || locked}
                value={
                  Number.isNaN(settings.frequencyCapPerSession)
                    ? ""
                    : String(settings.frequencyCapPerSession)
                }
                onChange={(e) =>
                  editSettings(
                    "frequencyCapPerSession",
                    e.target.value === "" ? NaN : Number(e.target.value),
                  )
                }
              />
              {(
                [
                  ["externalVastTagUrl", "External VAST tag URL", "رابط VAST الخارجي"],
                  [
                    "houseCreativeUrl",
                    "AYIN house creative MP4 URL",
                    "رابط فيديو إعلان AYIN بصيغة MP4",
                  ],
                  ["houseClickUrl", "House click URL", "رابط النقر لإعلان AYIN"],
                ] as const
              ).map(([key, en, arabic]) => (
                <TextField
                  key={key}
                  id={"video-ads-" + key}
                  label={copy(en, arabic)}
                  dir="auto"
                  disabled={busy || locked}
                  value={settings[key] ?? ""}
                  onChange={(e) => editSettings(key, e.target.value || null)}
                />
              ))}
              <ActionButton
                disabled={busy || locked || Object.keys(settingsDraft).length === 0}
                onClick={() => {
                  if (settingsOriginal)
                    void save({ kind: "SETTINGS", original: settingsOriginal, settings });
                }}
              >
                {copy("Save reviewed player defaults", "حفظ إعدادات المشغّل بعد المراجعة")}
              </ActionButton>
            </FormSection>
          </Disclosure>
        )}
        {snapshot && (
          <>
            <FormSection
              id="video-ads-directory"
              legend={copy("Find stored overrides", "البحث عن الاستثناءات المحفوظة")}
            >
              <TextField
                id="video-ads-query"
                label={copy(
                  "Channel name, handle or video title",
                  "اسم القناة أو معرّفها أو عنوان الفيديو",
                )}
                dir="auto"
                maxLength={200}
                value={filters.query}
                disabled={busy}
                onChange={(e) => setFilters({ ...filters, query: e.target.value, page: 1 })}
              />
              <SelectField
                id="video-ads-kind"
                label={copy("Target type", "نوع الهدف")}
                value={filters.targetType}
                disabled={busy}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    targetType: e.target.value as VideoAdFilters["targetType"],
                    page: 1,
                  })
                }
              >
                <option value="">{copy("All targets", "كل الأهداف")}</option>
                <option value="CHANNEL">{copy("Channels", "القنوات")}</option>
                <option value="VIDEO">{copy("Videos", "الفيديوهات")}</option>
              </SelectField>
              <p>
                {copy(
                  "Records reflect the last explicit verified read.",
                  "تعكس السجلات آخر قراءة صريحة تم التحقق منها.",
                )}
              </p>
              <p>
                {copy("Stored overrides", "الاستثناءات المحفوظة")}:{" "}
                {snapshot.directory.pagination.total} · {copy("Page", "الصفحة")}{" "}
                {snapshot.directory.pagination.page}/
                {Math.max(snapshot.directory.pagination.totalPages, 1)}
              </p>
              {snapshot.directory.items.map((row) => (
                <article className={styles.record} key={row.id} data-ad-override={row.id}>
                  <bdi>
                    {row.channel?.name ??
                      row.video?.title ??
                      copy("Target unavailable", "الهدف غير متاح")}
                  </bdi>
                  <ActionButton
                    disabled={busy || locked}
                    onClick={() =>
                      choose({
                        kind: row.channelId ? "CHANNEL" : "VIDEO",
                        id: row.channelId ?? row.videoId!,
                      })
                    }
                  >
                    {copy("Read this override", "قراءة هذا الاستثناء")}
                  </ActionButton>
                </article>
              ))}
              {!snapshot.directory.items.length && (
                <p>{copy("No matching stored overrides.", "لا توجد استثناءات محفوظة مطابقة.")}</p>
              )}
              <ActionButton
                disabled={busy || unappliedFilters || snapshot.directory.pagination.page === 1}
                onClick={() =>
                  void load({ ...filters, page: snapshot.directory.pagination.page - 1 })
                }
              >
                {copy("Previous page", "الصفحة السابقة")}
              </ActionButton>
              <ActionButton
                disabled={busy || unappliedFilters || !snapshot.directory.pagination.hasNext}
                onClick={() =>
                  void load({ ...filters, page: snapshot.directory.pagination.page + 1 })
                }
              >
                {copy("Next page", "الصفحة التالية")}
              </ActionButton>
            </FormSection>
            <Disclosure summary={copy("Find a channel or video target", "البحث عن قناة أو فيديو")}>
              <TextField
                id="video-ads-target-query"
                label={copy("Search channel or video", "البحث عن قناة أو فيديو")}
                dir="auto"
                maxLength={200}
                disabled={busy || locked}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ActionButton
                disabled={busy || locked || query.trim().length < 2}
                onClick={() => void read((a, s) => searchVideoAdTargets(a, query, s), setMatches)}
              >
                {copy("Find targets", "البحث عن أهداف")}
              </ActionButton>
              {matches && (
                <div>
                  {matches.channels.map((row) => (
                    <ActionButton
                      disabled={busy || locked}
                      key={row.id}
                      onClick={() => choose({ kind: "CHANNEL", id: row.id })}
                    >
                      {copy("Channel", "قناة")} · <bdi>{row.name}</bdi>
                    </ActionButton>
                  ))}
                  {matches.videos.map((row) => (
                    <ActionButton
                      disabled={busy || locked}
                      key={row.id}
                      onClick={() => choose({ kind: "VIDEO", id: row.id })}
                    >
                      {copy("Video", "فيديو")} · <bdi>{row.title}</bdi>
                    </ActionButton>
                  ))}
                  {!matches.channels.length && !matches.videos.length && (
                    <p>{copy("No matching targets.", "لا توجد أهداف مطابقة.")}</p>
                  )}
                </div>
              )}
            </Disclosure>
          </>
        )}
        {selected && values && (
          <FormSection
            id="video-ads-target-editor"
            legend={copy("Review target override", "مراجعة استثناء الهدف")}
          >
            <p>
              <bdi>{"name" in selected.target ? selected.target.name : selected.target.title}</bdi>
            </p>
            <DataBadge>
              {selected.override
                ? copy("Stored override", "استثناء محفوظ")
                : copy(
                    "No stored override; inherited policy",
                    "لا يوجد استثناء محفوظ؛ تُورّث السياسة",
                  )}
            </DataBadge>
            {(
              [
                ["enabled", "Ads on this target", "الإعلانات لهذا الهدف"],
                ["preRollEnabled", "Pre-roll override", "استثناء الإعلان قبل الفيديو"],
                ["midRollEnabled", "Mid-roll override", "استثناء الإعلان أثناء الفيديو"],
                ["postRollEnabled", "Post-roll override", "استثناء الإعلان بعد الفيديو"],
              ] as const
            ).map(([key, en, arabic]) => (
              <SelectField
                key={key}
                id={"video-ads-override-" + key}
                label={copy(en, arabic)}
                disabled={busy || locked}
                value={values[key] === null ? "INHERIT" : values[key] ? "ENABLED" : "DISABLED"}
                onChange={(e) =>
                  editOverride(
                    key,
                    e.target.value === "INHERIT" ? null : e.target.value === "ENABLED",
                  )
                }
              >
                <option value="INHERIT">{copy("Inherit", "توريث")}</option>
                <option value="ENABLED">{copy("Enabled", "مفعّل")}</option>
                <option value="DISABLED">{copy("Disabled", "معطّل")}</option>
              </SelectField>
            ))}
            <TextField
              id="video-ads-override-url"
              label={copy(
                "Override VAST URL (blank = inherit)",
                "رابط VAST للاستثناء (فارغ = توريث)",
              )}
              dir="auto"
              disabled={busy || locked}
              value={values.vastTagUrl ?? ""}
              onChange={(e) => editOverride("vastTagUrl", e.target.value || null)}
            />
            <TextField
              id="video-ads-override-interval"
              label={copy(
                "Override interval in seconds (blank = inherit)",
                "فاصل الاستثناء بالثواني (فارغ = توريث)",
              )}
              type="number"
              min={60}
              max={7200}
              disabled={busy || locked}
              value={
                values.midRollEverySec === null || Number.isNaN(values.midRollEverySec)
                  ? ""
                  : String(values.midRollEverySec)
              }
              onChange={(e) =>
                editOverride(
                  "midRollEverySec",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
            <ActionButton
              disabled={busy || locked || Object.keys(drafts[selectedKey ?? ""] ?? {}).length === 0}
              onClick={() => void save({ kind: "OVERRIDE", original: selected, values })}
            >
              {copy("Save reviewed override", "حفظ الاستثناء بعد المراجعة")}
            </ActionButton>
            <ActionButton
              disabled={busy || locked || !selected.override}
              onClick={() => {
                if (
                  window.confirm(
                    copy(
                      "Remove this reviewed override and inherit policy?",
                      "هل تريد إزالة هذا الاستثناء بعد المراجعة وتوريث السياسة؟",
                    ),
                  )
                )
                  void save({ kind: "DELETE", original: selected, values });
              }}
            >
              {copy("Remove reviewed override", "إزالة الاستثناء بعد المراجعة")}
            </ActionButton>
          </FormSection>
        )}
      </div>
    </div>
  );
}
