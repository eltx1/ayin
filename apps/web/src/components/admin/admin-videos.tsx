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
  videoStates,
  videoEditableStates,
  videoVisibilities,
  videoBulkActions,
  AdminVideoError,
  getAdminVideos,
  reviewAdminVideoTargets,
  saveAdminVideo,
  bulkVerifiedAdminVideos,
  type AdminVideoRecord,
  type AdminVideoSnapshot,
  type AdminVideoCommand,
  type VideoFilters,
  type VideoBulkAction,
} from "@/lib/admin-video-workspace";
import styles from "./admin-record-workspace.module.css";
type Draft = { values: AdminVideoCommand; dirty: boolean; changed: Array<keyof AdminVideoCommand> };
const fresh = (record: AdminVideoRecord): Draft => ({
  dirty: false,
  changed: [],
  values: {
    title: record.title,
    description: record.description ?? "",
    status: record.status,
    visibility: record.visibility,
    commentsEnabled: record.commentsEnabled,
    tvIncluded: record.tvControl?.included,
    reason: "",
  },
});
function rebase(record: AdminVideoRecord, draft?: Draft): Draft {
  const next = fresh(record);
  if (!draft) return next;
  const values = { ...next.values, reason: draft.values.reason };
  for (const key of draft.changed) Object.assign(values, { [key]: draft.values[key] });
  return { ...draft, values };
}
type Ack =
  | { kind: "single"; value: Awaited<ReturnType<typeof saveAdminVideo>> }
  | { kind: "bulk"; value: Awaited<ReturnType<typeof bulkVerifiedAdminVideos>> };
export function AdminVideos({ initialQuery = "" }: { initialQuery?: string }) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [filters, setFilters] = useState<VideoFilters>({
    query: initialQuery.slice(0, 200),
    status: "",
    visibility: "",
    page: 1,
  });
  const [snapshot, setSnapshot] = useState<AdminVideoSnapshot | null>(null),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string[]>([]),
    [bulkReason, setBulkReason] = useState("");
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<
      "read" | "denied" | "invalid" | "uncertain" | "verification" | null
    >(null);
  const [ack, setAck] = useState<Ack | null>(null),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [targets, setTargets] = useState<AdminVideoRecord[]>([]),
    [reviewRecords, setReviewRecords] = useState<
      Awaited<ReturnType<typeof reviewAdminVideoTargets>> | undefined
    >(undefined),
    [generation, setGeneration] = useState(0);
  const actor = useRef<AdminSession | null>(null),
    controller = useRef<AbortController | null>(null),
    operation = useRef(false),
    lock = useRef(false),
    body = useRef<HTMLDivElement | null>(null),
    dirty = useRef(false),
    initial = useRef(filters);
  const clearActor = useCallback(() => {
    if (body.current) body.current.hidden = true;
    actor.current = null;
    setSnapshot(null);
    setDrafts({});
    setSelected([]);
    setEditing({});
    setBulkReason("");
    setAck(null);
    setTargets([]);
    setReviewRecords(undefined);
    lock.current = true;
    setLocked(true);
    setReviewed(false);
    setError("denied");
  }, []);
  const load = useCallback(
    async (input: VideoFilters) => {
      if (operation.current) return;
      operation.current = true;
      const pending = new AbortController();
      controller.current = pending;
      setLoading(true);
      setError(null);
      setSnapshot(null);
      try {
        const result = await getAdminVideos(input, pending.signal, actor.current ?? undefined);
        if (pending.signal.aborted) return;
        if (body.current?.hidden) setGeneration((v) => v + 1);
        actor.current = result.session;
        setSnapshot(result);
        setFilters(input);
        setSelected([]);
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(
            result.directory.items.map((record) => [record.id, rebase(record, current[record.id])]),
          ),
        }));
      } catch (caught) {
        if (!pending.signal.aborted) {
          if (caught instanceof AdminVideoError && [401, 403].includes(caught.status)) clearActor();
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
      setReviewRecords(undefined);
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
    dirty.current =
      busy ||
      locked ||
      Boolean(bulkReason) ||
      Object.values(drafts).some((d) => d.dirty || d.values.reason);
  }, [busy, locked, drafts, bulkReason]);
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

  function edit(record: AdminVideoRecord, value: Partial<AdminVideoCommand>) {
    dirty.current = true;
    setDrafts((current) => {
      const draft = current[record.id] ?? fresh(record);
      const changed = [
        ...new Set([
          ...draft.changed,
          ...(Object.keys(value).filter((key) => key !== "reason") as Array<
            keyof AdminVideoCommand
          >),
        ]),
      ];
      return {
        ...current,
        [record.id]: { dirty: changed.length > 0, changed, values: { ...draft.values, ...value } },
      };
    });
  }
  async function run(records: AdminVideoRecord[], work: () => Promise<Ack>, success: () => void) {
    if (operation.current || lock.current || !actor.current) return;
    operation.current = true;
    lock.current = true;
    dirty.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setLocked(true);
    setBusy(true);
    setReviewed(false);
    setReviewRecords(undefined);
    setTargets(records);
    setError(null);
    try {
      const result = await work();
      if (pending.signal.aborted) return;
      setAck(result);
      success();
    } catch (caught) {
      if (pending.signal.aborted) return;
      if (caught instanceof AdminVideoError && caught.verificationRequired) {
        lock.current = false;
        setLocked(false);
        setError("verification");
      } else if (caught instanceof AdminVideoError && [401, 403].includes(caught.status))
        clearActor();
      else if (caught instanceof AdminVideoError && !caught.writeStarted) {
        lock.current = false;
        setLocked(false);
        setTargets([]);
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
  async function save(record: AdminVideoRecord, command: AdminVideoCommand) {
    await run(
      [record],
      async () => ({
        kind: "single",
        value: await saveAdminVideo(actor.current!, record, command, controller.current!.signal),
      }),
      () =>
        setDrafts((current) => ({
          ...current,
          [record.id]: { dirty: false, changed: [], values: { ...command, reason: "" } },
        })),
    );
  }
  async function bulk(action: VideoBulkAction) {
    const records =
      snapshot?.directory.items.filter((record) => selected.includes(record.id)) ?? [];
    if (records.length !== selected.length || !records.length) return;
    await run(
      records,
      async () => ({
        kind: "bulk",
        value: await bulkVerifiedAdminVideos(
          actor.current!,
          records,
          action,
          bulkReason,
          controller.current!.signal,
        ),
      }),
      () => setBulkReason(""),
    );
  }
  async function review() {
    if (operation.current || !actor.current || !targets.length) return;
    operation.current = true;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setReviewed(false);
    setError(null);
    try {
      const result = await reviewAdminVideoTargets(
        actor.current,
        targets.map((record) => record.id),
        pending.signal,
      );
      if (pending.signal.aborted) return;
      setReviewRecords(result);
      setSnapshot(null);
      setReviewed(true);
    } catch (caught) {
      if (!pending.signal.aborted) {
        if (caught instanceof AdminVideoError && [401, 403].includes(caught.status)) clearActor();
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
    DRAFT: copy("Draft", "مسودة"),
    UPLOADING: copy("Uploading", "جارٍ الرفع"),
    VALIDATING: copy("Validating", "جارٍ التحقق"),
    SCHEDULED: copy("Scheduled", "مجدول"),
    PUBLISHED: copy("Published", "منشور"),
    REMOVED: copy("Removed", "محذوف"),
  };
  const visibilities = {
    PUBLIC: copy("Public", "عام"),
    UNLISTED: copy("Unlisted", "غير مدرج"),
    PRIVATE: copy("Private", "خاص"),
  };
  const bulkNames = {
    UNPUBLISH: copy("Unpublish selected", "إلغاء نشر المحدد"),
    DISABLE_COMMENTS: copy("Disable selected comments", "تعطيل تعليقات المحدد"),
    ENABLE_COMMENTS: copy("Enable selected comments", "تفعيل تعليقات المحدد"),
  };
  const disabled = busy || loading || locked || !snapshot;
  const reasonValid = (value: string) => value.trim().length >= 8 && value.trim().length <= 500;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(ar ? "ar" : "en", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value));
  const filterEdit = (value: Partial<VideoFilters>) => {
    setFilters((current) => ({ ...current, ...value, page: 1 }));
    setSnapshot(null);
    setSelected([]);
  };
  return (
    <section className={styles.workspace} dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        title={copy("Videos", "الفيديوهات")}
        description={copy(
          "Review content and retained edits, then submit a reasoned moderation decision.",
          "راجع المحتوى وتعديلاتك المحفوظة، ثم أرسل قرار الإشراف مع السبب.",
        )}
        actions={
          <ActionButton
            tone="secondary"
            disabled={busy || loading}
            onClick={() => void load(filters)}
          >
            {copy("Read video records", "قراءة سجلات الفيديوهات")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {copy("Reading video records…", "جارٍ قراءة سجلات الفيديوهات…")}
        </StatusNotice>
      )}
      {error && (
        <StatusNotice tone="warning" announce="assertive">
          {error === "denied"
            ? copy(
                "Video access changed. Sign in with an authorized content account.",
                "تغيّرت صلاحية الفيديوهات. سجّل الدخول بحساب مخوّل للمحتوى.",
              )
            : error === "invalid"
              ? copy(
                  "Check the entered changes and reason. No write was started.",
                  "راجع التعديلات والسبب. لم تبدأ الكتابة.",
                )
              : error === "verification"
                ? copy(
                    "Verify your session, then submit explicitly. Edits and reasons are retained.",
                    "أعد التحقق من الجلسة، ثم أرسل بنفسك. احتفظنا بالتعديلات والأسباب.",
                  )
                : error === "uncertain"
                  ? copy(
                      "The response was not confirmed. Read every original target and review before another decision; this command will not be replayed.",
                      "لم يتأكد الرد. اقرأ كل فيديو أصلي وراجعه قبل قرار آخر؛ لن يُعاد الأمر تلقائيًا.",
                    )
                  : copy(
                      "Current video records could not be verified. Read them again.",
                      "تعذّر التحقق من سجلات الفيديوهات الحالية. اقرأها مجددًا.",
                    )}
        </StatusNotice>
      )}
      <div
        ref={body}
        key={generation}
        className={styles.privateBody}
        data-private-video-records="true"
      >
        <FormSection id="video-search" legend={copy("Find videos", "البحث عن الفيديوهات")}>
          <div className={styles.filters}>
            <TextField
              id="video-query"
              dir="auto"
              label={copy("Title, slug or channel name", "العنوان أو الرابط أو اسم القناة")}
              value={filters.query}
              maxLength={200}
              disabled={busy || loading}
              onChange={(event) => filterEdit({ query: event.target.value })}
            />
            <SelectField
              id="video-filter-status"
              label={copy("Video status", "حالة الفيديو")}
              value={filters.status}
              disabled={busy || loading}
              onChange={(event) => filterEdit({ status: event.target.value })}
            >
              <option value="">{copy("All statuses", "كل الحالات")}</option>
              {videoStates.map((value) => (
                <option key={value} value={value}>
                  {names[value]}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="video-filter-visibility"
              label={copy("Visibility", "الظهور")}
              value={filters.visibility}
              disabled={busy || loading}
              onChange={(event) => filterEdit({ visibility: event.target.value })}
            >
              <option value="">{copy("All visibility", "كل أنواع الظهور")}</option>
              {videoVisibilities.map((value) => (
                <option key={value} value={value}>
                  {visibilities[value]}
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
            <div data-testid="video-ack">
              {ack.kind === "single" ? (
                <>
                  <bdi>{ack.value.title}</bdi> · {names[ack.value.status]} ·{" "}
                  <bdi>{stamp(ack.value.updatedAt)} UTC</bdi>
                  {ack.value.tvControl && (
                    <p>
                      {copy("TV inclusion saved", "حُفظ تفضيل الإدراج في البث")}:{" "}
                      {ack.value.tvControl.included
                        ? copy("Included", "مدرج")
                        : copy("Excluded", "مستبعد")}{" "}
                      · <bdi>{ack.value.tvControl.id}</bdi>
                    </p>
                  )}
                </>
              ) : (
                <>
                  {bulkNames[ack.value.action]} · {ack.value.affected}
                </>
              )}
            </div>
            <p>
              {copy(
                "A failed later read does not undo this acknowledgment. Read the originals before another decision.",
                "فشل قراءة لاحقة لا يلغي هذا التأكيد. اقرأ الفيديوهات الأصلية قبل قرار آخر.",
              )}
            </p>
          </StatusNotice>
        )}
        {locked && (
          <FormSection
            id="video-recovery"
            legend={copy("Review before another operation", "المراجعة قبل عملية أخرى")}
          >
            {targets.length > 0 && (
              <>
                <ul>
                  {targets.map((record) => (
                    <li key={record.id}>
                      <bdi>{record.title}</bdi> · <bdi>{record.id}</bdi>
                    </li>
                  ))}
                </ul>
                <ActionButton
                  tone="secondary"
                  disabled={busy || loading}
                  onClick={() => void review()}
                >
                  {copy("Read original videos", "قراءة الفيديوهات الأصلية")}
                </ActionButton>
                {reviewRecords && (
                  <>
                    <ul data-testid="video-review">
                      {reviewRecords.map((result) => (
                        <li key={result.id}>
                          {result.record ? (
                            <>
                              <bdi>{result.record.title}</bdi> · {names[result.record.status]} ·{" "}
                              <bdi>{stamp(result.record.updatedAt)} UTC</bdi>
                            </>
                          ) : (
                            <>
                              {copy("Original video unavailable", "الفيديو الأصلي غير متاح")} ·{" "}
                              <bdi>{result.id}</bdi>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p>
                      {copy(
                        "Read video records to refresh the directory, then finish this review.",
                        "اقرأ سجلات الفيديوهات لتحديث القائمة، ثم أكمل المراجعة.",
                      )}
                    </p>
                  </>
                )}
              </>
            )}
            <ActionButton
              disabled={busy || loading || !snapshot || (targets.length > 0 && !reviewed)}
              onClick={() => {
                if (operation.current || !snapshot || (targets.length > 0 && !reviewed)) return;
                lock.current = false;
                setLocked(false);
                setTargets([]);
                setReviewRecords(undefined);
                setReviewed(false);
              }}
            >
              {copy("I reviewed; enable another operation", "راجعت الحالة؛ فعّل عملية أخرى")}
            </ActionButton>
          </FormSection>
        )}
        <p>
          {copy(
            "Records reflect the last explicit directory read. Dates use UTC.",
            "تعكس السجلات آخر قراءة صريحة للقائمة. التواريخ بالتوقيت العالمي UTC.",
          )}
        </p>
        {snapshot && (
          <>
            {(selected.length > 0 || Boolean(bulkReason)) && (
              <FormSection id="video-bulk" legend={copy("Selected videos", "الفيديوهات المحددة")}>
                <p>
                  {copy(
                    "Select videos on this page. Batch decisions change status or comments; metadata drafts are retained.",
                    "حدّد فيديوهات من هذه الصفحة. يغيّر القرار الجماعي الحالة أو التعليقات؛ وتظل مسودات البيانات محفوظة.",
                  )}{" "}
                  · {selected.length}
                </p>
                <TextAreaField
                  id="video-bulk-reason"
                  dir="auto"
                  label={copy(
                    "Bulk decision reason (8–500 characters)",
                    "سبب القرار الجماعي (٨–٥٠٠ حرف)",
                  )}
                  maxLength={500}
                  value={bulkReason}
                  disabled={disabled}
                  onChange={(event) => {
                    dirty.current = true;
                    setBulkReason(event.target.value);
                  }}
                />
                <div className={styles.actions}>
                  {videoBulkActions.map((action) => (
                    <ActionButton
                      key={action}
                      tone="danger"
                      disabled={disabled || !selected.length || !reasonValid(bulkReason)}
                      onClick={() => void bulk(action)}
                    >
                      {bulkNames[action]}
                    </ActionButton>
                  ))}
                </div>
              </FormSection>
            )}
            <div className={styles.list}>
              {snapshot.directory.items.map((record) => {
                const draft = drafts[record.id] ?? fresh(record),
                  values = draft.values,
                  readOnly = disabled || record.status === "REMOVED";
                return (
                  <article className={styles.record} key={record.id} data-video-record={record.id}>
                    <h2 dir="auto">{record.title}</h2>
                    <div className={styles.actions}>
                      <DataBadge>{names[record.status]}</DataBadge>
                      <DataBadge>{visibilities[record.visibility]}</DataBadge>
                      <bdi>@{record.channel.handle}</bdi>
                    </div>
                    <p>
                      {copy("Last updated", "آخر تحديث")} <bdi>{stamp(record.updatedAt)} UTC</bdi>
                    </p>
                    <label className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={selected.includes(record.id)}
                        disabled={readOnly}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, record.id]
                              : current.filter((value) => value !== record.id),
                          )
                        }
                      />
                      {copy("Select video for batch decision", "تحديد الفيديو للقرار الجماعي")}
                    </label>
                    <Disclosure
                      summary={copy("Channel, comments and reports", "القناة والتعليقات والبلاغات")}
                    >
                      <p>
                        <bdi>{record.channel.name}</bdi> · <bdi>{record.channel.id}</bdi>
                      </p>
                      <p>
                        {copy("Comments", "التعليقات")}: {record.counts.comments} ·{" "}
                        {copy("Reports", "البلاغات")}: {record.counts.reports}
                      </p>
                      <p>
                        {record.videoForm === "CLIP"
                          ? copy("Clip", "مقطع قصير")
                          : copy("Long form video", "فيديو طويل")}
                      </p>
                      {record.publishedAt && (
                        <p>
                          {copy("Published", "تاريخ النشر")}{" "}
                          <bdi>{stamp(record.publishedAt)} UTC</bdi>
                        </p>
                      )}
                    </Disclosure>
                    <Disclosure
                      summary={copy("Review and edit video", "مراجعة الفيديو وتعديله")}
                      open={Boolean(editing[record.id])}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setEditing((current) =>
                          current[record.id] === open ? current : { ...current, [record.id]: open },
                        );
                      }}
                    >
                      {editing[record.id] && (
                        <div className={styles.list}>
                          <TextField
                            id={`video-title-${record.id}`}
                            dir="auto"
                            label={copy("Title", "العنوان")}
                            value={values.title}
                            maxLength={200}
                            disabled={readOnly}
                            onChange={(event) => edit(record, { title: event.target.value })}
                          />
                          <TextAreaField
                            id={`video-description-${record.id}`}
                            dir="auto"
                            label={copy("Description", "الوصف")}
                            value={values.description}
                            maxLength={20000}
                            rows={4}
                            disabled={readOnly}
                            onChange={(event) => edit(record, { description: event.target.value })}
                          />
                          <div className={styles.filters}>
                            <SelectField
                              id={`video-status-${record.id}`}
                              label={copy("New status", "الحالة الجديدة")}
                              value={values.status}
                              disabled={readOnly}
                              onChange={(event) =>
                                edit(record, {
                                  status: event.target.value as AdminVideoRecord["status"],
                                })
                              }
                            >
                              {!videoEditableStates.includes(
                                record.status as (typeof videoEditableStates)[number],
                              ) && <option value={record.status}>{names[record.status]}</option>}
                              {videoEditableStates.map((status) => (
                                <option key={status} value={status}>
                                  {names[status]}
                                </option>
                              ))}
                            </SelectField>
                            <SelectField
                              id={`video-visibility-${record.id}`}
                              label={copy("New visibility", "الظهور الجديد")}
                              value={values.visibility}
                              disabled={readOnly}
                              onChange={(event) =>
                                edit(record, {
                                  visibility: event.target.value as AdminVideoRecord["visibility"],
                                })
                              }
                            >
                              {videoVisibilities.map((value) => (
                                <option key={value} value={value}>
                                  {visibilities[value]}
                                </option>
                              ))}
                            </SelectField>
                          </div>
                          <label className={styles.choice}>
                            <input
                              type="checkbox"
                              checked={values.commentsEnabled}
                              disabled={readOnly}
                              onChange={(event) =>
                                edit(record, { commentsEnabled: event.target.checked })
                              }
                            />
                            {copy("Comments enabled", "التعليقات مفعّلة")}
                          </label>
                          {record.tvControl ? (
                            <FormSection
                              id={`video-tv-${record.id}`}
                              legend={copy("TV inclusion preference", "تفضيل الإدراج في البث")}
                            >
                              <p>
                                <bdi>{record.tvControl.name}</bdi> ·{" "}
                                <bdi>{record.tvControl.id}</bdi>
                              </p>
                              <p>
                                {record.tvControl.origin === "DEFAULT"
                                  ? copy(
                                      "Default inclusion; no explicit preference is stored.",
                                      "إدراج افتراضي؛ لا يوجد تفضيل صريح محفوظ.",
                                    )
                                  : copy(
                                      "Explicit preference last read",
                                      "آخر قراءة للتفضيل الصريح",
                                    )}
                                {record.tvControl.updatedAt && (
                                  <>
                                    {" "}
                                    · <bdi>{stamp(record.tvControl.updatedAt)} UTC</bdi>
                                  </>
                                )}
                              </p>
                              <label className={styles.choice}>
                                <input
                                  type="checkbox"
                                  checked={values.tvIncluded ?? record.tvControl.included}
                                  disabled={readOnly}
                                  onChange={(event) =>
                                    edit(record, { tvIncluded: event.target.checked })
                                  }
                                />
                                {copy(
                                  "Include in this TV channel",
                                  "إدراج في هذه القناة التلفزيونية",
                                )}
                              </label>
                            </FormSection>
                          ) : (
                            <p>
                              {copy(
                                "No TV channel is available for this video.",
                                "لا توجد قناة تلفزيونية متاحة لهذا الفيديو.",
                              )}
                            </p>
                          )}
                          <TextAreaField
                            id={`video-reason-${record.id}`}
                            dir="auto"
                            label={copy(
                              "Video decision reason (8–500 characters)",
                              "سبب قرار الفيديو (٨–٥٠٠ حرف)",
                            )}
                            maxLength={500}
                            rows={3}
                            value={values.reason}
                            disabled={readOnly}
                            onChange={(event) => edit(record, { reason: event.target.value })}
                          />
                          <ActionButton
                            tone={values.status === "REMOVED" ? "danger" : "primary"}
                            disabled={
                              readOnly ||
                              !draft.dirty ||
                              !reasonValid(values.reason) ||
                              !values.title.trim()
                            }
                            onClick={() => void save(record, values)}
                          >
                            {copy(
                              "Save reviewed video changes",
                              "حفظ تعديلات الفيديو بعد المراجعة",
                            )}
                          </ActionButton>
                        </div>
                      )}
                    </Disclosure>
                  </article>
                );
              })}
            </div>
            {snapshot.directory.items.length === 0 && (
              <StatusNotice>
                {copy("No videos match these filters.", "لا توجد فيديوهات تطابق هذه المرشحات.")}
              </StatusNotice>
            )}
            <nav
              className={styles.actions}
              aria-label={copy("Video directory pages", "صفحات قائمة الفيديوهات")}
            >
              <ActionButton
                tone="secondary"
                disabled={busy || loading || snapshot.directory.pagination.page <= 1}
                onClick={() => void load({ ...filters, page: filters.page - 1 })}
              >
                {copy("Previous page", "الصفحة السابقة")}
              </ActionButton>
              <span>
                {snapshot.directory.pagination.page} / {snapshot.directory.pagination.pages} ·{" "}
                {snapshot.directory.pagination.total} {copy("videos", "فيديو")}
              </span>
              <ActionButton
                tone="secondary"
                disabled={
                  busy ||
                  loading ||
                  snapshot.directory.pagination.page >= snapshot.directory.pagination.pages ||
                  snapshot.directory.pagination.page >= 1000
                }
                onClick={() => void load({ ...filters, page: filters.page + 1 })}
              >
                {copy("Next page", "الصفحة التالية")}
              </ActionButton>
            </nav>
          </>
        )}
      </div>
    </section>
  );
}
