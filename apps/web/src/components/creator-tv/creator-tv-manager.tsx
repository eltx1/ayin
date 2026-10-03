"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  MetricList,
  PageHeader,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import {
  getTvManagement,
  saveTvPreference,
  tvPreferenceInput,
  TvManagementError,
  type ManagedTvVideo,
  type TvSnapshot,
} from "@/lib/creator-tv-management";
import styles from "./creator-tv-manager.module.css";
import { CreatorTvStatus } from "./creator-tv-status";

type Draft = { included: boolean; priority: string; sortOrder: string };
const initial = (row: ManagedTvVideo): Draft => ({
  included: row.included,
  priority: String(row.priority),
  sortOrder: row.sortOrder === null ? "" : String(row.sortOrder),
});
export function CreatorTvManager({ embedded = false }: { embedded?: boolean } = {}) {
  const Surface = embedded ? "div" : "main",
    { locale, href, formatNumber } = useI18n(),
    ar = locale === "ar",
    text = (en: string, arabic: string) => (ar ? arabic : en),
    [snapshot, setSnapshot] = useState<TvSnapshot | null>(null),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState<"read" | "denied" | "input" | "uncertain" | null>(null),
    [saved, setSaved] = useState<{ videoId: string; updatedAt: string } | null>(null),
    [page, setPage] = useState(1),
    context = useRef<TvSnapshot | null>(null),
    read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null),
    guard = useRef(false),
    decisionLocked = useRef(false);
  const clear = useCallback(() => {
    context.current = null;
    setSnapshot(null);
    setDrafts({});
    setSaved(null);
    setLocked(false);
    decisionLocked.current = false;
    setReviewed(false);
  }, []);
  const load = useCallback(async () => {
    if (guard.current) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(null);
    setReviewed(false);
    setSnapshot(null);
    try {
      const result = await getTvManagement(controller.signal, context.current ?? undefined);
      if (controller.signal.aborted) return;
      context.current = result;
      setSnapshot(result);
      setReviewed(true);
    } catch (caught) {
      if (controller.signal.aborted) return;
      const denied = caught instanceof TvManagementError && [401, 403].includes(caught.status);
      if (denied) clear();
      setError(denied ? "denied" : "read");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [clear]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    const hide = () => {
      read.current?.abort();
      write.current?.abort();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        guard.current = false;
        setSaving(false);
        setSnapshot(null);
        setLoading(false);
        setReviewed(false);
        setError("read");
        decisionLocked.current = true;
        setLocked(true);
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      hide();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [load]);
  const dirty = Object.keys(drafts).length > 0 || (locked && !saved);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        link &&
        !window.confirm(
          ar ? "المغادرة وفقد المسودات غير المحفوظة؟" : "Leave and discard unsaved drafts?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, ar]);
  async function save(row: ManagedTvVideo) {
    if (!snapshot || loading || guard.current || decisionLocked.current) return;
    const draft = drafts[row.id] ?? initial(row);
    let input;
    try {
      input = tvPreferenceInput(draft.included, draft.priority, draft.sortOrder);
    } catch {
      setError("input");
      return;
    }
    guard.current = true;
    setDrafts((current) => ({ ...current, [row.id]: draft }));
    setSaving(true);
    setError(null);
    setSaved(null);
    setReviewed(false);
    const controller = new AbortController();
    write.current = controller;
    try {
      const ack = await saveTvPreference(snapshot, row.id, input, controller.signal);
      if (controller.signal.aborted) return;
      setSaved({ videoId: ack.videoId, updatedAt: ack.updatedAt });
      setSnapshot((current) =>
        current
          ? {
              ...current,
              videos: current.videos.map((video) =>
                video.id === ack.videoId
                  ? {
                      ...video,
                      included: ack.included,
                      priority: ack.priority,
                      sortOrder: ack.sortOrder,
                    }
                  : video,
              ),
            }
          : current,
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (
        caught instanceof TvManagementError &&
        !caught.writeStarted &&
        [401, 403].includes(caught.status)
      ) {
        clear();
        setError("denied");
        return;
      }
      setDrafts((current) => ({ ...current, [row.id]: draft }));
      setError("uncertain");
    } finally {
      guard.current = false;
      if (!controller.signal.aborted) {
        setSaving(false);
        if (context.current) {
          decisionLocked.current = true;
          setLocked(true);
        }
      }
    }
  }
  const rows = snapshot?.videos ?? [],
    currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20))),
    start = (currentPage - 1) * 20,
    disabled = saving || loading || locked;
  return (
    <Surface className={styles.workspace}>
      <PageHeader
        title={text("Creator TV", "تلفزيون المنشئ")}
        description={text(
          "Manage the eligible videos in your channel rotation.",
          "إدارة المقاطع المؤهلة لدورة العرض في قناتك.",
        )}
        actions={
          <ActionButton tone="secondary" disabled={loading || saving} onClick={() => void load()}>
            {text("Review current rotation", "مراجعة دورة العرض الحالية")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {text("Loading current rotation…", "جارٍ تحميل دورة العرض الحالية…")}
        </StatusNotice>
      )}
      {saved && (
        <StatusNotice tone="success" announce="polite">
          {text(
            "Preference saved. Review the current rotation before another change.",
            "تم حفظ التفضيل. راجع دورة العرض الحالية قبل تعديل آخر.",
          )}{" "}
          <time dateTime={saved.updatedAt} dir="ltr">
            {saved.updatedAt}
          </time>
        </StatusNotice>
      )}
      {error && (
        <StatusNotice tone="danger" announce="assertive">
          {error === "denied"
            ? text(
                "Your account or channel changed, or access is unavailable. Sign in and reload.",
                "تغير الحساب أو القناة، أو لا تتوفر صلاحية الوصول. سجل الدخول وأعد التحميل.",
              )
            : error === "input"
              ? text(
                  "Enter a whole priority from −100000 to 100000 and an optional order from 0 to 1000000.",
                  "أدخل أولوية صحيحة من −١٠٠٠٠٠ إلى ١٠٠٠٠٠، وترتيبًا اختياريًا من ٠ إلى ١٠٠٠٠٠٠.",
                )
              : error === "uncertain"
                ? text(
                    "The save outcome could not be verified. Your draft is retained. Review current values before choosing another change.",
                    "تعذر التحقق من نتيجة الحفظ. تم الاحتفاظ بالمسودة. راجع القيم الحالية قبل اختيار تعديل آخر.",
                  )
                : text(
                    "Current rotation could not be verified. Retry the read.",
                    "تعذر التحقق من دورة العرض الحالية. أعد القراءة.",
                  )}
        </StatusNotice>
      )}
      {locked && (
        <StatusNotice tone="warning">
          <p>
            {text(
              "Changes remain locked until you review current values.",
              "تظل التعديلات مغلقة حتى مراجعة القيم الحالية.",
            )}
          </p>
          <ActionButton
            tone="secondary"
            disabled={!reviewed || loading || saving || !snapshot}
            onClick={() => {
              decisionLocked.current = false;
              setLocked(false);
              setSaved(null);
              setError(null);
            }}
          >
            {text("Confirm review and enable changes", "تأكيد المراجعة وتفعيل التعديلات")}
          </ActionButton>
        </StatusNotice>
      )}
      {snapshot && (
        <>
          <PageHeader
            level={2}
            title={snapshot.tv.name}
            description={snapshot.channel.name}
            actions={
              <ActionLink href={href(`/c/${encodeURIComponent(snapshot.channel.handle)}/tv`)}>
                {text("Watch TV", "مشاهدة التلفزيون")}
              </ActionLink>
            }
          />
          <MetricList
            label={text("Automatic programming", "البرمجة التلقائية")}
            items={[
              {
                label: text("Eligible videos", "المقاطع المؤهلة"),
                value: formatNumber(rows.length),
              },
              {
                label: text("Platform rotation", "دورة عرض المنصة"),
                value: snapshot.automation.platformEnabled
                  ? text("Available", "متاحة")
                  : text("Paused", "متوقفة"),
              },
              {
                label: text("Your channel rotation", "دورة عرض القناة"),
                value: snapshot.automation.channelScheduleEnabled
                  ? text("Active", "نشطة")
                  : text("Paused", "متوقفة"),
              },
              {
                label: text(
                  "Automatically add published videos",
                  "إضافة المقاطع المنشورة تلقائيًا",
                ),
                value: snapshot.automation.channelAutoAddEnabled
                  ? text("Enabled", "مفعّلة")
                  : text("Disabled", "معطّلة"),
              },
              {
                label: text("Guide window (minutes)", "نافذة الدليل بالدقائق"),
                value: formatNumber(snapshot.automation.guideWindowMinutes),
              },
            ]}
          />
          <CreatorTvStatus
            key={snapshot.tv.id}
            tvChannelId={snapshot.tv.id}
            accountId={snapshot.accountId}
            channelId={snapshot.channel.id}
          />
          <section className={styles.panel} aria-label={text("TV library", "مكتبة التلفزيون")}>
            <h2>{text("TV library", "مكتبة التلفزيون")}</h2>
            <p>
              {text(
                "Higher priority plays first. For equal priorities, an explicit order comes before automatic order. Remaining ties use the configured publication order.",
                "تُعرض الأولوية الأعلى أولًا. عند تساويها، يأتي الترتيب المحدد قبل الترتيب التلقائي. تُحسم بقية حالات التعادل بترتيب النشر المُعد.",
              )}
            </p>
            <p>
              {snapshot.automation.rotationMode === "PRIORITY_ORDER_OLDEST"
                ? text("Publication tie-break: oldest first.", "حسم التعادل بالنشر: الأقدم أولًا.")
                : text("Publication tie-break: newest first.", "حسم التعادل بالنشر: الأحدث أولًا.")}
            </p>
            {!rows.length ? (
              <p>
                {text(
                  "No eligible published public MP4 videos were returned.",
                  "لم تُرجع القراءة مقاطع MP4 عامة منشورة ومؤهلة.",
                )}
              </p>
            ) : (
              <ul className={styles.list}>
                {rows.slice(start, start + 20).map((row) => {
                  const draft = drafts[row.id] ?? initial(row);
                  return (
                    <li key={row.id}>
                      <Disclosure summary={row.title}>
                        <p dir="auto">{row.description}</p>
                        <p>
                          {text("Effective duration (seconds)", "مدة العرض الفعلية بالثواني")}:{" "}
                          {formatNumber(row.effectiveDurationMs / 1000)}
                        </p>
                        <p>
                          {text("Current saved values", "القيم المحفوظة الحالية")}:{" "}
                          {row.included ? text("Included", "مضمن") : text("Excluded", "مستبعد")} /{" "}
                          {formatNumber(row.priority)} /{" "}
                          {row.sortOrder === null
                            ? text("Automatic", "تلقائي")
                            : formatNumber(row.sortOrder)}
                        </p>
                        <form
                          className={styles.form}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void save(row);
                          }}
                        >
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={draft.included}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...draft, included: event.target.checked },
                                }))
                              }
                            />
                            {text("Include in rotation", "التضمين في دورة العرض")}
                          </label>
                          <TextField
                            id={`tv-priority-${row.id}`}
                            label={text("Priority", "الأولوية")}
                            type="number"
                            required
                            min={-100000}
                            max={100000}
                            step={1}
                            disabled={disabled}
                            value={draft.priority}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, priority: event.target.value },
                              }))
                            }
                          />
                          <TextField
                            id={`tv-order-${row.id}`}
                            label={text("Order", "الترتيب")}
                            hint={text(
                              "Leave blank for automatic order; zero is a valid explicit order.",
                              "اتركه فارغًا للترتيب التلقائي؛ الصفر ترتيب محدد صالح.",
                            )}
                            type="number"
                            min={0}
                            max={1000000}
                            step={1}
                            disabled={disabled}
                            value={draft.sortOrder}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, sortOrder: event.target.value },
                              }))
                            }
                          />
                          <ActionButton type="submit" disabled={disabled}>
                            {text("Save preference", "حفظ التفضيل")}
                          </ActionButton>
                        </form>
                      </Disclosure>
                    </li>
                  );
                })}
              </ul>
            )}
            {rows.length > 20 && (
              <PageControls
                label={text("TV library", "مكتبة التلفزيون")}
                summary={`${formatNumber(start + 1)}–${formatNumber(Math.min(start + 20, rows.length))} / ${formatNumber(rows.length)}`}
                previousLabel={text("Previous", "السابق")}
                nextLabel={text("Next", "التالي")}
                hasPrevious={currentPage > 1}
                hasNext={start + 20 < rows.length}
                onPrevious={() => setPage(currentPage - 1)}
                onNext={() => setPage(currentPage + 1)}
              />
            )}
          </section>
        </>
      )}
      {Object.entries(drafts).length > 0 && (
        <Disclosure summary={text("Retained preference drafts", "مسودات التفضيلات المحفوظة")}>
          <ul className={styles.list}>
            {Object.entries(drafts).map(([videoId, draft]) => (
              <li key={videoId}>
                <code>{videoId}</code>
                <p>
                  {draft.included ? text("Included", "مضمن") : text("Excluded", "مستبعد")} /{" "}
                  <bdi>{draft.priority}</bdi> /{" "}
                  <bdi>{draft.sortOrder || text("Automatic", "تلقائي")}</bdi>
                </p>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Surface>
  );
}
