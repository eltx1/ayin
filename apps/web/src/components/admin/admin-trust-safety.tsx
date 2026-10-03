"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import {
  ActionButton,
  DataBadge,
  FormSection,
  MetricList,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { EditorTabs } from "@/components/ui/editor-tabs";
import {
  AdminTrustError,
  adminActionInput,
  appealDecisions,
  canManageTrustSettings,
  caseDecisions,
  getAdminTrust,
  parseAdminTrustSettings,
  readTrustRecord,
  saveAdminTrust,
  takedownDecisions,
  trustKinds,
  trustLevels,
  type AdminTrustSnapshot,
  type TrustCurrentRecord,
  type TrustReviewTarget,
} from "@/lib/admin-trust";
import styles from "./admin-trust-safety.module.css";
const names: Record<string, readonly [string, string]> = {
  WARN: ["Warning", "تنبيه"],
  STRIKE: ["Channel strike", "مخالفة القناة"],
  SUSPEND_ACCOUNT: ["Suspend account", "تعليق الحساب"],
  SUSPEND_CHANNEL: ["Suspend channel", "تعليق القناة"],
  UNPUBLISH_VIDEO: ["Unpublish video", "إلغاء نشر الفيديو"],
  REMOVE_VIDEO: ["Remove video", "إزالة الفيديو"],
  OPEN: ["Open", "مفتوح"],
  REVIEWING: ["Under review", "قيد المراجعة"],
  RESOLVED: ["Resolved", "تم الحل"],
  ACTIONED: ["Actioned", "تم اتخاذ إجراء"],
  DISMISSED: ["Dismissed", "تم الرفض"],
  CLOSED: ["Closed", "مغلق"],
  UPHELD: ["Upheld", "تم تأييد الإجراء"],
  OVERTURNED: ["Overturned", "تم إلغاء الإجراء"],
  NEW: ["New", "جديد"],
  STANDARD: ["Standard", "عادي"],
  TRUSTED: ["Trusted", "موثوق"],
  RESTRICTED: ["Restricted", "مقيّد"],
  COPYRIGHT: ["Copyright", "حقوق النشر"],
  SPAM: ["Spam", "محتوى مزعج"],
  HARASSMENT: ["Harassment", "مضايقة"],
  HATE: ["Hate", "كراهية"],
  SEXUAL_CONTENT: ["Sexual content", "محتوى جنسي"],
  VIOLENCE: ["Violence", "عنف"],
  MISLEADING: ["Misleading", "مضلل"],
  OTHER: ["Other", "أخرى"],
  NOT_FOUND: ["No record was found in this read", "لم يتم العثور على سجل في هذه القراءة"],
};
function useTrustCopy() {
  const { locale, formatDate, formatNumber } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  return {
    text,
    number: formatNumber,
    label: (value: string) => names[value]?.[locale === "ar" ? 1 : 0] ?? value,
    date: (value: string) =>
      `${formatDate(value, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`,
  };
}
function TrustRows<T extends { id: string }>({
  title,
  rows,
  render,
}: {
  title: string;
  rows: readonly T[];
  render: (row: T) => ReactNode;
}) {
  const { text, number } = useTrustCopy(),
    [page, setPage] = useState(1),
    current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20))),
    start = (current - 1) * 20;
  return (
    <section className={styles.panel} aria-label={title}>
      <h2>{title}</h2>
      {rows.length ? (
        <ul className={styles.list}>
          {rows.slice(start, start + 20).map((row) => (
            <li key={row.id}>{render(row)}</li>
          ))}
        </ul>
      ) : (
        <p>{text("No records in this snapshot.", "لا توجد سجلات في هذه القراءة.")}</p>
      )}
      {rows.length > 20 ? (
        <PageControls
          label={title}
          summary={`${number(start + 1)}–${number(Math.min(start + 20, rows.length))} / ${number(rows.length)}`}
          previousLabel={text("Previous", "السابق")}
          nextLabel={text("Next", "التالي")}
          hasPrevious={current > 1}
          hasNext={start + 20 < rows.length}
          onPrevious={() => setPage(current - 1)}
          onNext={() => setPage(current + 1)}
        />
      ) : null}
    </section>
  );
}
type DecisionDraft = { status: string; resolution: string };
function DecisionForm({
  id,
  choices,
  draft,
  onChange,
  onSave,
  disabled,
  required,
}: {
  id: string;
  choices: readonly string[];
  draft: DecisionDraft;
  onChange: (draft: DecisionDraft) => void;
  onSave: () => void;
  disabled: boolean;
  required: boolean;
}) {
  const { text, label } = useTrustCopy();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className={styles.form}
    >
      <SelectField
        id={`${id}-decision`}
        label={text("Decision", "القرار")}
        value={draft.status}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, status: event.target.value })}
      >
        {choices.map((value) => (
          <option key={value} value={value}>
            {label(value)}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        id={`${id}-resolution`}
        label={text("Decision reason", "سبب القرار")}
        value={draft.resolution}
        required={required}
        minLength={required ? 10 : 0}
        maxLength={4000}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, resolution: event.target.value })}
      />
      <ActionButton type="submit" disabled={disabled}>
        {text("Save decision", "حفظ القرار")}
      </ActionButton>
    </form>
  );
}
const emptyAction = () => ({
  kind: "WARN",
  reason: "",
  caseId: "",
  targetAccountId: "",
  channelId: "",
  videoId: "",
});
export function AdminTrustSafety() {
  const { text, label, date, number } = useTrustCopy(),
    { locale, direction } = useI18n();
  const [snapshot, setSnapshot] = useState<AdminTrustSnapshot | null>(null),
    [settingsDraft, setSettingsDraft] = useState<{ blockedTerms: string; review: boolean }>({
      blockedTerms: "",
      review: false,
    }),
    [actionDraft, setActionDraft] = useState(emptyAction),
    [channelDraft, setChannelDraft] = useState({
      channelId: "",
      level: "STANDARD",
      reviewRequired: false,
    }),
    [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({}),
    [tab, setTab] = useState("queue");
  const [settingsEdited, setSettingsEdited] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [notice, setNotice] = useState<"saved" | "reviewed" | null>(null),
    [error, setError] = useState<"read" | "denied" | "invalid" | "uncertain" | null>(null),
    [currentRecord, setCurrentRecord] = useState<TrustCurrentRecord | null>(null);
  const mounted = useRef(false),
    read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null),
    decisionLocked = useRef(false),
    settingsDirty = useRef(false),
    owner = useRef<string | null>(null),
    reviewTarget = useRef<TrustReviewTarget | null>(null);
  const clearDrafts = useCallback(() => {
    setActionDraft(emptyAction());
    setChannelDraft({ channelId: "", level: "STANDARD", reviewRequired: false });
    setDrafts({});
    setSettingsDraft({ blockedTerms: "", review: false });
    settingsDirty.current = false;
    setSettingsEdited(false);
    reviewTarget.current = null;
    setCurrentRecord(null);
  }, []);
  const readSnapshot = useCallback(() => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const bounded = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      target = reviewTarget.current;
    return Promise.all([
      getAdminTrust(bounded),
      target ? readTrustRecord(target, bounded) : Promise.resolve(null),
    ])
      .then(([next, record]) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (owner.current && owner.current !== next.session.accountId)
          throw new AdminTrustError(401);
        owner.current = next.session.accountId;
        setSnapshot(next);
        setCurrentRecord(record);
        setReviewed(true);
        if (!settingsDirty.current)
          setSettingsDraft({
            blockedTerms: next.settings.blockedTerms.join("\n"),
            review: next.settings.newCreatorsRequireReview,
          });
      })
      .catch((caught: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (caught instanceof AdminTrustError && [401, 403].includes(caught.status)) {
          owner.current = null;
          clearDrafts();
          setSnapshot(null);
          setError("denied");
        } else setError("read");
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) {
          read.current = null;
          setLoading(false);
        }
      });
  }, [clearDrafts]);
  const refresh = useCallback(() => {
    if (write.current) return;
    setSnapshot(null);
    setCurrentRecord(null);
    setLoading(true);
    setError(null);
    setReviewed(false);
    void readSnapshot();
  }, [readSnapshot]);
  useEffect(() => {
    mounted.current = true;
    void readSnapshot();
    const hide = () => {
      read.current?.abort();
      if (write.current) {
        decisionLocked.current = true;
        setLocked(true);
        setUncertain(true);
        write.current.abort();
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        write.current = null;
        setBusy(false);
        refresh();
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      read.current?.abort();
      write.current?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [readSnapshot, refresh]);
  const dirty = Boolean(
    settingsEdited ||
    actionDraft.kind !== "WARN" ||
    actionDraft.reason.trim() ||
    actionDraft.caseId ||
    actionDraft.targetAccountId ||
    actionDraft.channelId ||
    actionDraft.videoId ||
    channelDraft.level !== "STANDARD" ||
    channelDraft.reviewRequired ||
    channelDraft.channelId ||
    Object.keys(drafts).length ||
    uncertain,
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || write.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === "_blank" ||
        target.hasAttribute("download") ||
        target.href === location.href
      )
        return;
      if (
        !window.confirm(
          locale === "ar"
            ? "مغادرة الصفحة؟ ستفقد المسودات المحلية."
            : "Leave this page? Your local drafts will be lost.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, locale]);
  const disabled = busy || locked || loading || !snapshot;
  async function mutate(
    path: string,
    method: "POST" | "PATCH" | "PUT",
    body: object,
    target: TrustReviewTarget | null = null,
  ): Promise<boolean> {
    if (write.current || read.current || decisionLocked.current || !snapshot) return false;
    const controller = new AbortController();
    write.current = controller;
    decisionLocked.current = true;
    reviewTarget.current = target;
    setBusy(true);
    setLocked(true);
    setReviewed(false);
    setCurrentRecord(null);
    setNotice(null);
    setError(null);
    try {
      await saveAdminTrust(path, method, body, snapshot.session.accountId, controller.signal);
      if (!mounted.current) return false;
      setNotice("saved");
      setUncertain(false);
      return true;
    } catch (caught: unknown) {
      if (mounted.current) {
        if (
          caught instanceof AdminTrustError &&
          !caught.writeStarted &&
          [401, 403].includes(caught.status)
        ) {
          owner.current = null;
          clearDrafts();
          setSnapshot(null);
          setError("denied");
          setUncertain(false);
        } else {
          setUncertain(true);
          setError("uncertain");
        }
      }
      return false;
    } finally {
      if (mounted.current) {
        write.current = null;
        setBusy(false);
      }
    }
  }
  async function action(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let input: ReturnType<typeof adminActionInput>;
    try {
      input = adminActionInput(actionDraft);
    } catch {
      setError("invalid");
      return;
    }
    if (await mutate("/admin/trust/actions", "POST", input)) setActionDraft(emptyAction());
  }
  async function channel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        channelDraft.channelId.trim(),
      ) ||
      !trustLevels.includes(channelDraft.level as (typeof trustLevels)[number])
    ) {
      setError("invalid");
      return;
    }
    const id = channelDraft.channelId.trim().toLowerCase();
    if (
      await mutate(
        `/admin/trust/channels/${id}`,
        "PUT",
        { level: channelDraft.level, reviewRequired: channelDraft.reviewRequired },
        { kind: "channels", id },
      )
    )
      setChannelDraft({ channelId: "", level: "STANDARD", reviewRequired: false });
  }
  async function settings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !canManageTrustSettings(snapshot.session.roles)) return;
    let body: ReturnType<typeof parseAdminTrustSettings>;
    try {
      body = parseAdminTrustSettings({
        blockedTerms: settingsDraft.blockedTerms
          .split(/\r?\n/u)
          .map((term) => term.trim())
          .filter(Boolean),
        newCreatorsRequireReview: settingsDraft.review,
      });
    } catch {
      setError("invalid");
      return;
    }
    if (await mutate("/admin/trust/settings", "PUT", body)) {
      settingsDirty.current = false;
      setSettingsEdited(false);
    }
  }
  function draft(kind: string, id: string): DecisionDraft {
    return drafts[`${kind}:${id}`] ?? { status: "REVIEWING", resolution: "" };
  }
  function decision(
    kind: "cases" | "appeals" | "takedowns",
    id: string,
    choices: readonly string[],
  ) {
    const value = draft(kind, id),
      resolution = value.resolution.trim();
    if (
      !choices.includes(value.status) ||
      resolution.length > 4000 ||
      (kind !== "cases" && resolution.length < 10)
    ) {
      setError("invalid");
      return;
    }
    void mutate(
      `/admin/trust/${kind}/${id}`,
      "PATCH",
      { status: value.status, ...(resolution ? { resolution } : {}) },
      { kind, id },
    ).then((saved) => {
      if (saved)
        setDrafts((old) => {
          const next = { ...old };
          delete next[`${kind}:${id}`];
          return next;
        });
    });
  }
  const decisionForm = (
    kind: "cases" | "appeals" | "takedowns",
    id: string,
    choices: readonly string[],
  ) => (
    <DecisionForm
      id={`${kind}-${id}`}
      choices={choices}
      draft={draft(kind, id)}
      disabled={disabled}
      required={kind !== "cases"}
      onChange={(value) => setDrafts((old) => ({ ...old, [`${kind}:${id}`]: value }))}
      onSave={() => decision(kind, id, choices)}
    />
  );
  const references = (items: ReadonlyArray<[string, string | null]>) => (
    <dl className={styles.references}>
      {items
        .filter(([, value]) => value !== null)
        .map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd dir="ltr">{value}</dd>
          </div>
        ))}
    </dl>
  );
  const queue = snapshot?.queue;
  const queueContent = queue ? (
    <div className={styles.stack}>
      <TrustRows
        title={text("Reports", "البلاغات")}
        rows={queue.reports}
        render={(row) => (
          <>
            <DataBadge>{label(row.status)}</DataBadge>
            <Disclosure summary={`${label(row.reason)} · ${date(row.createdAt)}`}>
              <p dir="auto" className={styles.prose}>
                {row.details ?? text("No additional details.", "لا توجد تفاصيل إضافية.")}
              </p>
              {references([
                [text("Report", "البلاغ"), row.id],
                [text("Video", "الفيديو"), row.videoId],
                [text("Comment", "التعليق"), row.commentId],
                [text("Channel", "القناة"), row.channelId],
              ])}
            </Disclosure>
          </>
        )}
      />
      <TrustRows
        title={text("Moderation cases", "حالات الإشراف")}
        rows={queue.cases}
        render={(row) => (
          <>
            <DataBadge>{label(row.status)}</DataBadge>
            <Disclosure summary={`${text("Case", "الحالة")} · ${date(row.createdAt)}`}>
              <p className={styles.prose}>
                {row.resolution ?? text("No recorded resolution.", "لا يوجد قرار مسجل.")}
              </p>
              {row.summary !== null ? (
                <p dir="auto" className={styles.prose}>
                  {row.summary}
                </p>
              ) : null}
              {references([
                [text("Case", "الحالة"), row.id],
                [text("Assigned operator", "المشرف المسؤول"), row.assignedToAccountId],
              ])}
              <p>
                {text("Linked reports", "البلاغات المرتبطة")}: {number(row.reports.length)}
              </p>
              {row.reports.map((report) => (
                <Disclosure key={report.id} summary={label(report.reason)}>
                  <p className={styles.prose}>
                    {report.details ?? text("No additional details.", "لا توجد تفاصيل إضافية.")}
                  </p>
                  {references([
                    [text("Report", "البلاغ"), report.id],
                    [text("Video", "الفيديو"), report.videoId],
                    [text("Comment", "التعليق"), report.commentId],
                  ])}
                </Disclosure>
              ))}
            </Disclosure>
            {decisionForm("cases", row.id, caseDecisions)}
          </>
        )}
      />
      <TrustRows
        title={text("Takedown requests", "طلبات إزالة المحتوى")}
        rows={queue.takedowns}
        render={(row) => (
          <>
            <DataBadge>{label(row.status)}</DataBadge>
            <Disclosure summary={`${row.claimantName} · ${date(row.createdAt)}`}>
              <p dir="auto">{row.contactEmail}</p>
              <p dir="auto">{row.rightsBasis}</p>
              <p dir="auto" className={styles.prose}>
                {row.details}
              </p>
              {references([
                [text("Request", "الطلب"), row.id],
                [text("Video", "الفيديو"), row.videoId],
              ])}
            </Disclosure>
            {decisionForm("takedowns", row.id, takedownDecisions)}
          </>
        )}
      />
      <TrustRows
        title={text("Appeals", "الاستئنافات")}
        rows={queue.appeals}
        render={(row) => (
          <>
            <DataBadge>{label(row.status)}</DataBadge>
            <Disclosure summary={`${label(row.action.kind)} · ${date(row.createdAt)}`}>
              <p dir="auto" className={styles.prose}>
                {row.message}
              </p>
              <p dir="auto" className={styles.prose}>
                {row.action.reason}
              </p>
              {references([
                [text("Appeal", "الاستئناف"), row.id],
                [text("Action", "الإجراء"), row.actionId],
                [text("Account", "الحساب"), row.action.targetAccountId],
                [text("Channel", "القناة"), row.action.channelId],
                [text("Video", "الفيديو"), row.action.videoId],
              ])}
            </Disclosure>
            {decisionForm("appeals", row.id, appealDecisions)}
          </>
        )}
      />
    </div>
  ) : null;
  const enforcement = (
    <FormSection
      id="trust-enforcement"
      legend={text("Enforcement action", "إجراء الإشراف")}
      description={text(
        "Select a decision and enter the actual reason. Resource references are available in the queue.",
        "اختر القرار واكتب السبب الفعلي. مراجع الموارد متاحة في قائمة الحالات.",
      )}
    >
      <form className={styles.form} onSubmit={(event) => void action(event)}>
        <SelectField
          id="trust-action-kind"
          name="kind"
          label={text("Action", "الإجراء")}
          value={actionDraft.kind}
          disabled={disabled}
          onChange={(event) => setActionDraft({ ...actionDraft, kind: event.target.value })}
        >
          {trustKinds.map((kind) => (
            <option key={kind} value={kind}>
              {label(kind)}
            </option>
          ))}
        </SelectField>
        <Disclosure summary={text("Resource references", "مراجع الموارد")}>
          {(["caseId", "targetAccountId", "channelId", "videoId"] as const).map((key, index) => (
            <TextField
              key={key}
              id={`trust-action-${key}`}
              label={
                [
                  text("Case reference", "مرجع الحالة"),
                  text("Account reference", "مرجع الحساب"),
                  text("Channel reference", "مرجع القناة"),
                  text("Video reference", "مرجع الفيديو"),
                ][index]!
              }
              name={key}
              value={actionDraft[key]}
              placeholder={
                [
                  text("Case UUID (optional)", "مرجع الحالة UUID (اختياري)"),
                  text("Account UUID when required", "مرجع الحساب UUID عند الحاجة"),
                  text("Channel UUID when required", "مرجع القناة UUID عند الحاجة"),
                  text("Video UUID when required", "مرجع الفيديو UUID عند الحاجة"),
                ][index]
              }
              maxLength={36}
              dir="ltr"
              disabled={disabled}
              onChange={(event) => setActionDraft({ ...actionDraft, [key]: event.target.value })}
            />
          ))}
        </Disclosure>
        <TextAreaField
          id="trust-action-reason"
          name="reason"
          label={text("Detailed enforcement reason", "السبب التفصيلي للإجراء")}
          placeholder={text("Detailed enforcement reason", "السبب التفصيلي للإجراء")}
          required
          minLength={10}
          maxLength={4000}
          value={actionDraft.reason}
          disabled={disabled}
          onChange={(event) => setActionDraft({ ...actionDraft, reason: event.target.value })}
        />
        <ActionButton type="submit" disabled={disabled} pending={busy}>
          {text("Record enforcement action", "تسجيل إجراء الإشراف")}
        </ActionButton>
      </form>
    </FormSection>
  );
  const controls = (
    <div className={styles.stack}>
      {enforcement}
      <FormSection id="trust-creator-controls" legend={text("Creator trust", "ثقة المنشئ")}>
        <form className={styles.form} onSubmit={(event) => void channel(event)}>
          <TextField
            id="trust-channel-id"
            label={text("Channel reference", "مرجع القناة")}
            value={channelDraft.channelId}
            required
            maxLength={36}
            dir="ltr"
            disabled={disabled}
            onChange={(event) =>
              setChannelDraft({ ...channelDraft, channelId: event.target.value })
            }
          />
          <SelectField
            id="trust-channel-level"
            label={text("Trust level", "مستوى الثقة")}
            value={channelDraft.level}
            disabled={disabled}
            onChange={(event) => setChannelDraft({ ...channelDraft, level: event.target.value })}
          >
            {trustLevels.map((level) => (
              <option key={level} value={level}>
                {label(level)}
              </option>
            ))}
          </SelectField>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={channelDraft.reviewRequired}
              disabled={disabled}
              onChange={(event) =>
                setChannelDraft({ ...channelDraft, reviewRequired: event.target.checked })
              }
            />
            {text("Require manual review", "يتطلب مراجعة يدوية")}
          </label>
          <ActionButton type="submit" disabled={disabled}>
            {text("Update creator trust", "تحديث ثقة المنشئ")}
          </ActionButton>
        </form>
      </FormSection>
    </div>
  );
  const settingsContent = (
    <FormSection
      id="trust-safety-defaults"
      legend={text("Safety defaults", "إعدادات السلامة")}
      description={text(
        "Operations, Admin and Super Admin can change these settings.",
        "يمكن لفريق العمليات والمسؤول والمسؤول الأعلى تعديل هذه الإعدادات.",
      )}
    >
      <form className={styles.form} onSubmit={(event) => void settings(event)}>
        <TextAreaField
          id="trust-blocked-terms"
          label={text("Blocked terms — one per line", "المصطلحات المحظورة — مصطلح في كل سطر")}
          value={settingsDraft.blockedTerms}
          disabled={disabled || !snapshot || !canManageTrustSettings(snapshot.session.roles)}
          onChange={(event) => {
            settingsDirty.current = true;
            setSettingsEdited(true);
            setSettingsDraft({ ...settingsDraft, blockedTerms: event.target.value });
          }}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settingsDraft.review}
            disabled={disabled || !snapshot || !canManageTrustSettings(snapshot.session.roles)}
            onChange={(event) => {
              settingsDirty.current = true;
              setSettingsEdited(true);
              setSettingsDraft({ ...settingsDraft, review: event.target.checked });
            }}
          />
          {text("New creators require review", "المنشئون الجدد يحتاجون إلى مراجعة")}
        </label>
        <ActionButton
          type="submit"
          disabled={disabled || !snapshot || !canManageTrustSettings(snapshot.session.roles)}
        >
          {text("Save safety defaults", "حفظ إعدادات السلامة")}
        </ActionButton>
      </form>
    </FormSection>
  );
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={text("Trust & Safety", "الثقة والسلامة")}
        description={text(
          "Review reports, decisions, appeals and creator trust.",
          "مراجعة البلاغات والقرارات والاستئنافات وثقة المنشئين.",
        )}
        actions={
          <ActionButton tone="secondary" onClick={refresh} disabled={busy || loading}>
            {text("Review current queue", "مراجعة القائمة الحالية")}
          </ActionButton>
        }
      />
      {loading ? (
        <StatusNotice announce="polite">
          {text("Loading current records…", "جارٍ تحميل السجلات الحالية…")}
        </StatusNotice>
      ) : null}
      {notice ? (
        <StatusNotice tone="success" announce="polite">
          {notice === "saved"
            ? text(
                "Operation saved. Refresh the queue before another decision.",
                "تم حفظ العملية. راجع القائمة قبل قرار آخر.",
              )
            : text(
                "Current queue reviewed. Choose the next decision explicitly.",
                "تمت مراجعة القائمة الحالية. اختر القرار التالي بنفسك.",
              )}
        </StatusNotice>
      ) : null}
      {error ? (
        <StatusNotice tone="danger" announce="assertive">
          {error === "denied"
            ? text(
                "This role cannot read Trust & Safety, or your identity changed. Reload after signing in.",
                "هذه الصلاحية لا تسمح بقراءة الثقة والسلامة، أو تغير الحساب. أعد التحميل بعد تسجيل الدخول.",
              )
            : error === "invalid"
              ? text(
                  "Check the decision, required resource references and reason.",
                  "راجع القرار ومراجع الموارد المطلوبة والسبب.",
                )
              : error === "uncertain"
                ? text(
                    "The operation outcome could not be verified. Your draft is retained. Review current records before deciding what to do next.",
                    "تعذر التحقق من نتيجة العملية. تم الاحتفاظ بالمسودة. راجع السجلات الحالية قبل اختيار الخطوة التالية.",
                  )
                : text(
                    "Current records could not be verified. Retry the read; decision controls remain unavailable.",
                    "تعذر التحقق من السجلات الحالية. أعد القراءة؛ تظل أدوات القرار غير متاحة.",
                  )}
        </StatusNotice>
      ) : null}
      {locked ? (
        <StatusNotice tone="warning">
          <p>
            {text(
              "Decision controls are locked until explicit review. No write is repeated automatically.",
              "أدوات القرار مقفلة حتى المراجعة الصريحة. لا تتم إعادة العملية تلقائيًا.",
            )}
          </p>
          {currentRecord ? (
            <div className={styles.prose}>
              <h2>{text("Current saved record", "السجل المحفوظ الحالي")}</h2>
              {references([[text("Reference", "المرجع"), currentRecord.id]])}
              <p>
                {label(currentRecord.state)}{" "}
                {currentRecord.updatedAt ? `· ${date(currentRecord.updatedAt)}` : ""}
              </p>
              {currentRecord.resolution !== null ? (
                <p dir="auto">{currentRecord.resolution}</p>
              ) : null}
              {currentRecord.reviewRequired !== null ? (
                <p>
                  {text("Manual review required", "يتطلب مراجعة يدوية")}:{" "}
                  {currentRecord.reviewRequired ? text("Yes", "نعم") : text("No", "لا")}
                </p>
              ) : null}
            </div>
          ) : null}
          <ActionButton
            tone="secondary"
            disabled={!reviewed || busy || loading}
            onClick={() => {
              decisionLocked.current = false;
              setLocked(false);
              setUncertain(false);
              setError(null);
              setNotice("reviewed");
            }}
          >
            {text("Confirm review and enable decisions", "تأكيد المراجعة وتفعيل القرارات")}
          </ActionButton>
        </StatusNotice>
      ) : null}
      {snapshot ? (
        <>
          <MetricList
            label={text("Current queue", "القائمة الحالية")}
            items={[
              { label: text("Reports", "البلاغات"), value: number(snapshot.queue.reports.length) },
              { label: text("Cases", "الحالات"), value: number(snapshot.queue.cases.length) },
              {
                label: text("Takedowns", "طلبات الإزالة"),
                value: number(snapshot.queue.takedowns.length),
              },
              {
                label: text("Appeals", "الاستئنافات"),
                value: number(snapshot.queue.appeals.length),
              },
            ]}
          />
          <StatusNotice>
            {text(
              "Each queue contains up to 250 open or reviewing records; these counts describe this snapshot, not all historical work. Page controls expose every returned row.",
              "تحتوي كل قائمة على ٢٥٠ سجلًا مفتوحًا أو قيد المراجعة كحد أقصى؛ الأعداد تخص هذه القراءة وليست جميع السجلات التاريخية. أدوات الصفحات تعرض كل الصفوف التي تم إرجاعها.",
            )}
          </StatusNotice>
        </>
      ) : null}
      <EditorTabs
        label={text("Trust workspaces", "مساحات عمل الثقة")}
        value={tab}
        onChange={setTab}
        direction={direction}
        tabs={[
          { id: "queue", label: text("Queue", "القائمة"), content: queueContent },
          { id: "decisions", label: text("Decisions", "القرارات"), content: controls },
          {
            id: "history",
            label: text("Your actions", "إجراءاتك"),
            content: snapshot ? (
              <TrustRows
                title={text("Your recent enforcement actions", "أحدث إجراءات الإشراف الخاصة بك")}
                rows={snapshot.actions}
                render={(row) => (
                  <Disclosure summary={`${label(row.kind)} · ${date(row.createdAt)}`}>
                    <p dir="auto" className={styles.prose}>
                      {row.reason}
                    </p>
                    {references([
                      [text("Action", "الإجراء"), row.id],
                      [text("Account", "الحساب"), row.targetAccountId],
                      [text("Channel", "القناة"), row.channelId],
                      [text("Video", "الفيديو"), row.videoId],
                      [text("Case", "الحالة"), row.caseId],
                    ])}
                  </Disclosure>
                )}
              />
            ) : null,
          },
          { id: "settings", label: text("Settings", "الإعدادات"), content: settingsContent },
        ]}
      />
      {Object.keys(drafts).length ? (
        <Disclosure summary={text("Retained decision drafts", "مسودات القرارات المحفوظة")}>
          {Object.entries(drafts).map(([id, value]) => (
            <div key={id}>
              {references([[text("Reference", "المرجع"), id.split(":")[1] ?? id]])}
              <p>{label(value.status)}</p>
              <p dir="auto" className={styles.prose}>
                {value.resolution}
              </p>
            </div>
          ))}
        </Disclosure>
      ) : null}
    </div>
  );
}
