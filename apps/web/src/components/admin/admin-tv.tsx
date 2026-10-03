"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  PageHeader,
  StatusNotice,
  TextField,
  TextAreaField,
  SelectField,
  FormSection,
  DataBadge,
} from "@/components/ui/design-system";
import { Disclosure } from "@/components/ui/data-presentation";
import type { AdminSession } from "@/lib/admin-control";
import {
  tvStates,
  AdminTvError,
  getAdminTv,
  reviewAdminTv,
  saveAdminTv,
  type AdminTvAck,
  type AdminTvCommand,
  type AdminTvRecord,
  type AdminTvSnapshot,
  type TvFilters,
} from "@/lib/admin-tv-workspace";
import styles from "./admin-record-workspace.module.css";
type Draft = { reason: string };
const fresh = (): Draft => ({ reason: "" });
export function AdminTv({ initialQuery = "" }: { initialQuery?: string }) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [filters, setFilters] = useState<TvFilters>({
    query: initialQuery.slice(0, 200),
    status: "",
    page: 1,
  });
  const [snapshot, setSnapshot] = useState<AdminTvSnapshot | null>(null),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<
      "read" | "denied" | "invalid" | "uncertain" | "verification" | null
    >(null);
  const [ack, setAck] = useState<AdminTvAck | null>(null),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [target, setTarget] = useState<AdminTvRecord | null>(null),
    [reviewRecord, setReviewRecord] = useState<AdminTvRecord | null | undefined>(undefined),
    [generation, setGeneration] = useState(0);
  const actor = useRef<AdminSession | null>(null),
    controller = useRef<AbortController | null>(null),
    operation = useRef(false),
    lock = useRef(false),
    body = useRef<HTMLDivElement | null>(null),
    dirty = useRef(false),
    initial = useRef(filters);
  const clearActor = useCallback(() => {
    actor.current = null;
    setSnapshot(null);
    setDrafts({});
    setAck(null);
    setTarget(null);
    setReviewRecord(undefined);
    lock.current = true;
    setLocked(true);
    setReviewed(false);
    setError("denied");
  }, []);
  const load = useCallback(
    async (input: TvFilters) => {
      if (operation.current) return;
      operation.current = true;
      const pending = new AbortController();
      controller.current = pending;
      setLoading(true);
      setError(null);
      setSnapshot(null);
      try {
        const result = await getAdminTv(input, pending.signal, actor.current ?? undefined);
        if (pending.signal.aborted) return;
        if (body.current?.hidden) setGeneration((value) => value + 1);
        actor.current = result.session;
        setSnapshot(result);
        setFilters(input);
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(
            result.directory.items.map((record) => [record.id, current[record.id] ?? fresh()]),
          ),
        }));
      } catch (caught) {
        if (!pending.signal.aborted) {
          if (caught instanceof AdminTvError && [401, 403].includes(caught.status)) clearActor();
          else setError("read");
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
      if (active) void load(initial.current);
    });
    const hide = () => {
      const pending = controller.current;
      controller.current = null;
      operation.current = false;
      pending?.abort();
      if (body.current) body.current.hidden = true;
      lock.current = true;
      setLocked(true);
      setReviewed(false);
      setSnapshot(null);
      setReviewRecord(undefined);
      setBusy(false);
      setLoading(false);
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
    dirty.current = busy || locked || Object.values(drafts).some((d) => d.reason);
  }, [busy, locked, drafts]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
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
            ? "لديك مسودة أو عملية تحتاج للمراجعة. هل تريد المغادرة؟"
            : "You have a draft or an operation awaiting review. Leave this page?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [ar]);
  function edit(record: AdminTvRecord, value: Partial<Draft>) {
    dirty.current = true;
    setDrafts((current) => ({
      ...current,
      [record.id]: { ...(current[record.id] ?? fresh()), ...value },
    }));
  }
  async function save(record: AdminTvRecord, command: AdminTvCommand) {
    if (operation.current || lock.current || !actor.current) return;
    operation.current = true;
    lock.current = true;
    dirty.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setLocked(true);
    setBusy(true);
    setReviewed(false);
    setReviewRecord(undefined);
    setTarget(record);
    setError(null);
    try {
      const result = await saveAdminTv(actor.current, record, command, pending.signal);
      if (pending.signal.aborted) return;
      setAck(result);
      setDrafts((current) => ({ ...current, [record.id]: { reason: "" } }));
    } catch (caught) {
      if (pending.signal.aborted) return;
      if (caught instanceof AdminTvError && caught.verificationRequired) {
        lock.current = false;
        setLocked(false);
        setError("verification");
      } else if (caught instanceof AdminTvError && [401, 403].includes(caught.status)) clearActor();
      else if (caught instanceof AdminTvError && !caught.writeStarted) {
        lock.current = false;
        setLocked(false);
        setTarget(null);
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
  async function review() {
    if (operation.current || !actor.current || !target) return;
    operation.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setReviewed(false);
    setError(null);
    try {
      const result = await reviewAdminTv(actor.current, target.id, pending.signal);
      if (pending.signal.aborted) return;
      setReviewRecord(result);
      setSnapshot((current) => {
        if (!current || !result || (filters.status && result.status !== filters.status))
          return null;
        return {
          ...current,
          directory: {
            ...current.directory,
            items: current.directory.items.map((record) =>
              record.id === result.id ? result : record,
            ),
          },
        };
      });
      setReviewed(true);
    } catch (caught) {
      if (!pending.signal.aborted) {
        if (caught instanceof AdminTvError && [401, 403].includes(caught.status)) clearActor();
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
  const names = {
    ACTIVE: copy("Active", "نشط"),
    OFF_AIR: copy("Off air", "خارج البث"),
    DISABLED: copy("Disabled", "معطّل"),
  };
  const actions = {
    ACTIVE: copy("Enable TV", "تفعيل القناة التلفزيونية"),
    OFF_AIR: copy("Take off air", "إيقاف البث"),
    DISABLED: copy("Disable TV", "تعطيل القناة التلفزيونية"),
  };
  const disabled = busy || loading || locked || !snapshot;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(ar ? "ar" : "en", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value));
  return (
    <section className={styles.workspace} dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        title={copy("Creator TV", "قنوات المنشئين التلفزيونية")}
        description={copy(
          "Review TV status and scheduling, then make an explicit audited decision.",
          "راجع حالة القنوات وجدول البث، ثم اتخذ قرارًا صريحًا ومدقّقًا.",
        )}
        actions={
          <ActionButton
            tone="secondary"
            disabled={busy || loading}
            onClick={() => void load(filters)}
          >
            {copy("Read TV records", "قراءة سجلات القنوات التلفزيونية")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {copy("Reading TV records…", "جارٍ قراءة سجلات القنوات التلفزيونية…")}
        </StatusNotice>
      )}
      {error && (
        <StatusNotice tone="warning" announce="assertive">
          {error === "denied"
            ? copy(
                "TV access changed. Sign in with an authorized Operations account.",
                "تغيّرت صلاحية إدارة القنوات. سجّل الدخول بحساب مخوّل للتشغيل.",
              )
            : error === "invalid"
              ? copy(
                  "Check the entered values. No write was started.",
                  "راجع البيانات المُدخلة. لم تبدأ الكتابة.",
                )
              : error === "verification"
                ? copy(
                    "Verify your session, then submit explicitly. Your reason is retained.",
                    "أعد التحقق من الجلسة، ثم أرسل بنفسك. احتفظنا بالسبب.",
                  )
                : error === "uncertain"
                  ? copy(
                      "The response was not confirmed. Read the original TV and review before another operation; this request will not be replayed.",
                      "لم يتأكد الرد. اقرأ القناة الأصلية وراجعها قبل عملية أخرى؛ لن يُعاد الطلب تلقائيًا.",
                    )
                  : copy(
                      "Current TV records could not be verified. Read them again.",
                      "تعذّر التحقق من سجلات القنوات الحالية. اقرأها مجددًا.",
                    )}
        </StatusNotice>
      )}
      <div
        ref={body}
        key={generation}
        className={styles.privateBody}
        data-private-tv-records="true"
      >
        <FormSection
          id="tv-search"
          legend={copy("Find TV channels", "البحث عن القنوات التلفزيونية")}
        >
          <div className={styles.filters}>
            <TextField
              id="tv-query"
              dir="auto"
              label={copy("TV or owner channel name", "اسم القناة التلفزيونية أو القناة المالكة")}
              value={filters.query}
              maxLength={200}
              disabled={busy || loading}
              onChange={(event) => {
                setFilters((current) => ({ ...current, query: event.target.value, page: 1 }));
                setSnapshot(null);
              }}
            />
            <SelectField
              id="tv-filter-status"
              label={copy("TV status", "حالة القناة التلفزيونية")}
              value={filters.status}
              disabled={busy || loading}
              onChange={(event) => {
                setFilters((current) => ({ ...current, status: event.target.value, page: 1 }));
                setSnapshot(null);
              }}
            >
              <option value="">{copy("All statuses", "كل الحالات")}</option>
              {tvStates.map((status) => (
                <option key={status} value={status}>
                  {names[status]}
                </option>
              ))}
            </SelectField>
          </div>
        </FormSection>
        {ack && (
          <StatusNotice
            tone="success"
            announce="polite"
            title={copy("Server acknowledgment", "تأكيد الخادم")}
          >
            <div data-testid="tv-ack">
              <bdi>{ack.name}</bdi> · {names[ack.status]} · {stamp(ack.updatedAt)} UTC
            </div>
            <p>
              {copy(
                "Records remain the last explicit read. A failed later read does not undo this acknowledgment.",
                "تظل السجلات آخر قراءة صريحة. فشل قراءة لاحقة لا يلغي هذا التأكيد.",
              )}
            </p>
          </StatusNotice>
        )}
        {locked && (
          <FormSection
            id="tv-recovery"
            legend={copy("Review before another operation", "المراجعة قبل عملية أخرى")}
          >
            {target && (
              <>
                <p>
                  <bdi>{target.name}</bdi> · <bdi>{target.id}</bdi>
                </p>
                <ActionButton
                  tone="secondary"
                  disabled={busy || loading}
                  onClick={() => void review()}
                >
                  {copy("Read original TV", "قراءة القناة التلفزيونية الأصلية")}
                </ActionButton>
                {reviewRecord !== undefined && (
                  <p data-testid="tv-review">
                    {reviewRecord ? (
                      <>
                        <bdi>{reviewRecord.name}</bdi> · {names[reviewRecord.status]} ·{" "}
                        {stamp(reviewRecord.updatedAt)} UTC
                      </>
                    ) : (
                      copy(
                        "The original TV is no longer available.",
                        "القناة التلفزيونية الأصلية لم تعد متاحة.",
                      )
                    )}
                  </p>
                )}
              </>
            )}
            <ActionButton
              disabled={busy || loading || (target ? !reviewed : !snapshot)}
              onClick={() => {
                if (operation.current || (target ? !reviewed : !snapshot)) return;
                lock.current = false;
                setLocked(false);
                setTarget(null);
                setReviewRecord(undefined);
                setReviewed(false);
              }}
            >
              {copy("I reviewed; enable another operation", "راجعت الحالة؛ فعّل عملية أخرى")}
            </ActionButton>
          </FormSection>
        )}
        <p>
          {copy(
            "Records reflect the last explicit read. Dates use UTC. Two current/upcoming schedule items are returned per TV.",
            "تعكس السجلات آخر قراءة صريحة. التواريخ بالتوقيت العالمي UTC. يرجع حتى عنصرين من جدول البث الحالي أو القادم لكل قناة.",
          )}
        </p>
        {snapshot && (
          <>
            <div className={styles.list}>
              {snapshot.directory.items.map((record) => {
                const draft = drafts[record.id] ?? fresh();
                const reasonValid =
                  draft.reason.trim().length >= 8 && draft.reason.trim().length <= 500;
                return (
                  <article className={styles.record} key={record.id} data-tv-record={record.id}>
                    <h2 dir="auto">{record.name}</h2>
                    <div className={styles.actions}>
                      <DataBadge>{names[record.status]}</DataBadge>
                      <bdi>@{record.channel.handle}</bdi>
                    </div>
                    <p>
                      {copy("Last updated", "آخر تحديث")} {stamp(record.updatedAt)} UTC
                    </p>
                    <Disclosure
                      summary={copy(
                        "Owner channel and current/upcoming schedule",
                        "القناة المالكة وجدول البث الحالي أو القادم",
                      )}
                    >
                      <p>
                        <bdi>{record.channel.name}</bdi> · <bdi>{record.channel.id}</bdi>
                      </p>
                      {record.scheduleItems.length ? (
                        record.scheduleItems.map((item) => (
                          <p key={item.id}>
                            <bdi>{item.video.title}</bdi> · {stamp(item.startsAt)} →{" "}
                            {stamp(item.endsAt)} UTC
                          </p>
                        ))
                      ) : (
                        <p>
                          {copy(
                            "No current or upcoming schedule items.",
                            "لا توجد عناصر في جدول البث الحالي أو القادم.",
                          )}
                        </p>
                      )}
                    </Disclosure>
                    <TextAreaField
                      id={`tv-reason-${record.id}`}
                      dir="auto"
                      label={copy(
                        "TV decision reason (8–500 characters)",
                        "سبب قرار القناة التلفزيونية (٨–٥٠٠ حرف)",
                      )}
                      maxLength={500}
                      rows={4}
                      value={draft.reason}
                      disabled={disabled}
                      onChange={(event) => edit(record, { reason: event.target.value })}
                    />
                    <div className={styles.actions}>
                      {tvStates.map((status) => (
                        <ActionButton
                          key={status}
                          tone={status === "ACTIVE" ? "primary" : "danger"}
                          disabled={disabled || !reasonValid || record.status === status}
                          onClick={() => void save(record, { status, reason: draft.reason })}
                        >
                          {actions[status]}
                        </ActionButton>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            {snapshot.directory.items.length === 0 && (
              <StatusNotice>
                {copy(
                  "No TV records match these filters.",
                  "لا توجد سجلات قنوات تطابق هذه المرشحات.",
                )}
              </StatusNotice>
            )}
            <div className={styles.actions}>
              <ActionButton
                tone="secondary"
                disabled={busy || loading || filters.page <= 1}
                onClick={() => void load({ ...filters, page: filters.page - 1 })}
              >
                {copy("Previous", "السابق")}
              </ActionButton>
              <span>
                {copy("Page", "صفحة")} {snapshot.directory.pagination.page} /{" "}
                {snapshot.directory.pagination.pages} · {snapshot.directory.pagination.total}
              </span>
              <ActionButton
                tone="secondary"
                disabled={
                  busy ||
                  loading ||
                  filters.page >= Math.min(snapshot.directory.pagination.pages, 1000)
                }
                onClick={() => void load({ ...filters, page: filters.page + 1 })}
              >
                {copy("Next", "التالي")}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
