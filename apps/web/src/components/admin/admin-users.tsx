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
  accountStates,
  AdminUsersError,
  getAdminUsers,
  reviewAdminUser,
  saveAdminUser,
  type AdminUserAck,
  type AdminUserCommand,
  type AdminUserRecord,
  type AdminUsersSnapshot,
  type UserFilters,
} from "@/lib/admin-users-workspace";
import styles from "./admin-record-workspace.module.css";
type Draft = { name: string; dirty: boolean; statusReason: string; sessionReason: string };
const fresh = (record: AdminUserRecord): Draft => ({
  name: record.displayName,
  dirty: false,
  statusReason: "",
  sessionReason: "",
});
export function AdminUsers({ initialQuery = "" }: { initialQuery?: string }) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [filters, setFilters] = useState<UserFilters>({
    query: initialQuery.slice(0, 200),
    status: "",
    page: 1,
  });
  const [snapshot, setSnapshot] = useState<AdminUsersSnapshot | null>(null),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<
      "read" | "denied" | "invalid" | "uncertain" | "verification" | null
    >(null);
  const [ack, setAck] = useState<AdminUserAck | null>(null),
    [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [target, setTarget] = useState<AdminUserRecord | null>(null),
    [reviewRecord, setReviewRecord] = useState<AdminUserRecord | null | undefined>(undefined),
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
    setFilters({ query: "", status: "", page: 1 });
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
    async (input: UserFilters) => {
      if (operation.current) return;
      operation.current = true;
      const pending = new AbortController();
      controller.current = pending;
      setLoading(true);
      setError(null);
      setSnapshot(null);
      try {
        const result = await getAdminUsers(input, pending.signal, actor.current ?? undefined);
        if (pending.signal.aborted) return;
        if (body.current?.hidden) setGeneration((value) => value + 1);
        actor.current = result.session;
        setSnapshot(result);
        setFilters(input);
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(
            result.directory.items.map((record) => [
              record.id,
              current[record.id] ?? fresh(record),
            ]),
          ),
        }));
      } catch (caught) {
        if (!pending.signal.aborted) {
          if (caught instanceof AdminUsersError && [401, 403].includes(caught.status)) clearActor();
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
    dirty.current =
      busy ||
      locked ||
      Object.values(drafts).some((d) => d.dirty || d.statusReason || d.sessionReason);
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
  function edit(record: AdminUserRecord, value: Partial<Draft>) {
    dirty.current = true;
    setDrafts((current) => ({
      ...current,
      [record.id]: { ...(current[record.id] ?? fresh(record)), ...value },
    }));
  }
  async function save(record: AdminUserRecord, command: AdminUserCommand) {
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
      const result = await saveAdminUser(actor.current, record, command, pending.signal);
      if (pending.signal.aborted) return;
      setAck(result);
      setDrafts((current) => {
        const draft = current[record.id];
        if (!draft) return current;
        return {
          ...current,
          [record.id]: {
            ...draft,
            ...(command.kind === "name"
              ? { name: result.displayName, dirty: false }
              : command.kind === "status"
                ? { statusReason: "" }
                : { sessionReason: "" }),
          },
        };
      });
    } catch (caught) {
      if (pending.signal.aborted) return;
      if (caught instanceof AdminUsersError && caught.verificationRequired) {
        lock.current = false;
        setLocked(false);
        setError("verification");
      } else if (caught instanceof AdminUsersError && [401, 403].includes(caught.status))
        clearActor();
      else if (caught instanceof AdminUsersError && !caught.writeStarted) {
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
      const result = await reviewAdminUser(actor.current, target.id, pending.signal);
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
        if (caught instanceof AdminUsersError && [401, 403].includes(caught.status)) clearActor();
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
      SUSPENDED: copy("Suspended", "موقوف"),
      CLOSED: copy("Closed", "مغلق"),
    },
    disabled = busy || loading || locked || !snapshot;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(ar ? "ar" : "en", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value));
  return (
    <section className={styles.workspace} dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        title={copy("Users & accounts", "المستخدمون والحسابات")}
        description={copy(
          "Review accounts and make explicit, audited decisions.",
          "راجع الحسابات واتخذ قرارات صريحة ومدققة.",
        )}
        actions={
          <ActionButton
            tone="secondary"
            disabled={busy || loading}
            onClick={() => void load(filters)}
          >
            {copy("Read account records", "قراءة سجلات الحسابات")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {copy("Reading account records…", "جارٍ قراءة سجلات الحسابات…")}
        </StatusNotice>
      )}
      {error && (
        <StatusNotice tone="warning" announce="assertive">
          {error === "denied"
            ? copy(
                "Account access changed. Sign in with an authorized Operations account.",
                "تغيرت صلاحية الحساب. سجّل الدخول بحساب مخوّل للتشغيل.",
              )
            : error === "invalid"
              ? copy(
                  "Check the entered values. No write was started.",
                  "راجع البيانات المُدخلة. لم تبدأ الكتابة.",
                )
              : error === "verification"
                ? copy(
                    "Verify your session, then submit explicitly. Your draft is retained.",
                    "أعد التحقق من الجلسة، ثم أرسل بنفسك. احتفظنا بالمسودة.",
                  )
                : error === "uncertain"
                  ? copy(
                      "The response was not confirmed. Read the original account and review before another operation; this request will not be replayed.",
                      "لم يتأكد الرد. اقرأ الحساب الأصلي وراجعه قبل عملية أخرى؛ لن يُعاد الطلب تلقائيًا.",
                    )
                  : copy(
                      "Current records could not be verified. Read them again.",
                      "تعذر التحقق من السجلات الحالية. اقرأها مجددًا.",
                    )}
        </StatusNotice>
      )}
      <div
        ref={body}
        key={generation}
        className={styles.privateBody}
        data-private-account-records="true"
      >
        <FormSection id="account-search" legend={copy("Find accounts", "البحث عن الحسابات")}>
          <div className={styles.filters}>
            <TextField
              id="account-query"
              label={copy("Email or display name", "البريد أو الاسم الظاهر")}
              value={filters.query}
              maxLength={200}
              disabled={busy || loading}
              onChange={(event) => {
                setFilters((current) => ({ ...current, page: 1, query: event.target.value }));
                setSnapshot(null);
              }}
            />
            <SelectField
              id="account-filter-status"
              label={copy("Account status", "حالة الحساب")}
              value={filters.status}
              disabled={busy || loading}
              onChange={(event) => {
                setFilters((current) => ({ ...current, page: 1, status: event.target.value }));
                setSnapshot(null);
              }}
            >
              <option value="">{copy("All statuses", "كل الحالات")}</option>
              {accountStates.map((state) => (
                <option key={state} value={state}>
                  {names[state]}
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
            <div data-testid="account-ack">
              <bdi>{ack.email}</bdi> ·{" "}
              {ack.kind === "sessions" ? (
                copy("Existing sessions revoked", "إبطال الجلسات القائمة")
              ) : ack.kind === "name" ? (
                <bdi>{ack.displayName}</bdi>
              ) : ack.status ? (
                names[ack.status]
              ) : (
                "—"
              )}
              {ack.updatedAt && <> · {stamp(ack.updatedAt)} UTC</>}
            </div>
            <p>
              {copy(
                "Saved records remain the last explicit read. A failed later read does not undo this acknowledgment.",
                "تظل السجلات آخر قراءة صريحة. فشل قراءة لاحقة لا يلغي هذا التأكيد.",
              )}
            </p>
          </StatusNotice>
        )}
        {locked && (
          <FormSection
            id="account-recovery"
            legend={copy("Review before another operation", "المراجعة قبل عملية أخرى")}
          >
            {target && (
              <>
                <p>
                  <bdi>{target.email}</bdi> · <bdi>{target.id}</bdi>
                </p>
                <ActionButton
                  tone="secondary"
                  disabled={busy || loading}
                  onClick={() => void review()}
                >
                  {copy("Read original account", "قراءة الحساب الأصلي")}
                </ActionButton>
                {reviewRecord !== undefined && (
                  <p data-testid="account-review">
                    {reviewRecord ? (
                      <>
                        <bdi>{reviewRecord.displayName}</bdi> · {names[reviewRecord.status]} ·{" "}
                        {stamp(reviewRecord.updatedAt)} UTC
                      </>
                    ) : (
                      copy(
                        "The original account is no longer available.",
                        "الحساب الأصلي لم يعد متاحًا.",
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
        {snapshot && (
          <>
            <p>
              {copy(
                "Records reflect the last explicit read. Dates use UTC. Up to three owned channels are returned per account.",
                "تعكس السجلات آخر قراءة صريحة. التواريخ بالتوقيت العالمي UTC. يُرجع حتى ثلاث قنوات مملوكة لكل حساب.",
              )}
            </p>
            {!snapshot.directory.items.length && (
              <StatusNotice>
                {copy("No matching accounts on this page.", "لا توجد حسابات مطابقة في هذه الصفحة.")}
              </StatusNotice>
            )}
            <div className={styles.list}>
              {snapshot.directory.items.map((record) => {
                const draft = drafts[record.id] ?? fresh(record);
                return (
                  <article key={record.id} className={styles.record}>
                    <header>
                      <h2>
                        <bdi>{record.email}</bdi>
                      </h2>
                      <DataBadge>{names[record.status]}</DataBadge>
                      <p>
                        {copy("Joined", "انضم")} {stamp(record.createdAt)} UTC
                      </p>
                    </header>
                    <Disclosure
                      summary={copy("Account and owned channels", "الحساب والقنوات المملوكة")}
                    >
                      <p>
                        <bdi>{record.id}</bdi>
                      </p>
                      <p>
                        {copy("Email verified", "البريد موثّق")}:{" "}
                        {record.emailVerifiedAt
                          ? stamp(record.emailVerifiedAt) + " UTC"
                          : copy("Not verified", "غير موثّق")}
                      </p>
                      <p>
                        {copy("Updated", "آخر تحديث")}: {stamp(record.updatedAt)} UTC
                      </p>
                      {record.channelMemberships.map(({ channel }) => (
                        <p key={channel.id}>
                          <bdi>@{channel.handle}</bdi> · <bdi>{channel.name}</bdi> ·{" "}
                          {
                            {
                              ACTIVE: copy("Active", "نشطة"),
                              HIDDEN: copy("Hidden", "مخفية"),
                              SUSPENDED: copy("Suspended", "موقوفة"),
                              REMOVED: copy("Removed", "محذوفة"),
                            }[channel.status]
                          }
                        </p>
                      ))}
                    </Disclosure>
                    <FormSection
                      id={"account-name-" + record.id}
                      legend={copy("Display name", "الاسم الظاهر")}
                    >
                      <TextField
                        id={"account-display-name-" + record.id}
                        label={copy("New display name", "الاسم الظاهر الجديد")}
                        value={draft.name}
                        maxLength={120}
                        disabled={disabled}
                        onChange={(event) =>
                          edit(record, { name: event.target.value, dirty: true })
                        }
                      />
                      <ActionButton
                        disabled={disabled || !draft.dirty || !draft.name.trim()}
                        onClick={() => void save(record, { kind: "name", displayName: draft.name })}
                      >
                        {copy("Save display name", "حفظ الاسم الظاهر")}
                      </ActionButton>
                    </FormSection>
                    <Disclosure summary={copy("Account access decisions", "قرارات وصول الحساب")}>
                      <FormSection
                        id={"account-sessions-" + record.id}
                        legend={copy("Revoke sessions", "إبطال الجلسات")}
                      >
                        <TextAreaField
                          id={"account-session-reason-" + record.id}
                          label={copy(
                            "Session revocation reason (8–500 characters)",
                            "سبب إبطال الجلسات (٨–٥٠٠ حرف)",
                          )}
                          value={draft.sessionReason}
                          maxLength={500}
                          disabled={disabled}
                          onChange={(event) => edit(record, { sessionReason: event.target.value })}
                        />
                        <ActionButton
                          tone="danger"
                          disabled={disabled || draft.sessionReason.trim().length < 8}
                          onClick={() =>
                            void save(record, { kind: "sessions", reason: draft.sessionReason })
                          }
                        >
                          {copy("Revoke existing sessions", "إبطال الجلسات القائمة")}
                        </ActionButton>
                      </FormSection>
                      {record.status !== "CLOSED" && (
                        <FormSection
                          id={"account-status-" + record.id}
                          legend={copy("Change account status", "تغيير حالة الحساب")}
                        >
                          <TextAreaField
                            id={"account-status-reason-" + record.id}
                            label={copy(
                              "Account status reason (8–500 characters)",
                              "سبب حالة الحساب (٨–٥٠٠ حرف)",
                            )}
                            value={draft.statusReason}
                            maxLength={500}
                            disabled={disabled}
                            onChange={(event) => edit(record, { statusReason: event.target.value })}
                          />
                          <ActionButton
                            tone={record.status === "SUSPENDED" ? "secondary" : "danger"}
                            disabled={
                              disabled ||
                              draft.statusReason.trim().length < 8 ||
                              (record.id === snapshot.session.accountId &&
                                record.status !== "SUSPENDED")
                            }
                            onClick={() =>
                              void save(record, {
                                kind: "status",
                                status: record.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
                                reason: draft.statusReason,
                              })
                            }
                          >
                            {record.status === "SUSPENDED"
                              ? copy("Reactivate account", "إعادة تنشيط الحساب")
                              : copy("Suspend account", "إيقاف الحساب")}
                          </ActionButton>
                        </FormSection>
                      )}
                    </Disclosure>
                  </article>
                );
              })}
            </div>
            <nav className={styles.actions} aria-label={copy("Account pages", "صفحات الحسابات")}>
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
                  filters.page >= Math.min(1000, snapshot.directory.pagination.pages)
                }
                onClick={() => void load({ ...filters, page: filters.page + 1 })}
              >
                {copy("Next", "التالي")}
              </ActionButton>
            </nav>
          </>
        )}
      </div>
    </section>
  );
}
