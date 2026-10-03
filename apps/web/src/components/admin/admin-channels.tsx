"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  PageHeader,
  StatusNotice,
  MetricList,
  TextField,
  TextAreaField,
  FormSection,
  DataBadge,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import {
  AdminChannelsError,
  adminChannelInput,
  channelStates,
  contractStates,
  getAdminChannels,
  reviewAdminChannel,
  saveAdminChannel,
  type AdminChannelDraft,
  type AdminChannelRecord,
  type AdminChannelsSnapshot,
} from "@/lib/admin-channels";
import type { AdminSession } from "@/lib/admin-control";
import styles from "./admin-channels.module.css";
type RetainedDraft = { value: AdminChannelDraft; dirty: boolean; base: AdminChannelRecord };
function initial(row: AdminChannelRecord): AdminChannelDraft {
  const contract = row.creatorContracts[0];
  return {
    name: row.name,
    description: row.description ?? "",
    status: row.status,
    contractStatus: contract?.status ?? "PENDING",
    revenueShareBps:
      contract?.revenueShareBps === null || contract?.revenueShareBps === undefined
        ? ""
        : String(contract.revenueShareBps),
    isPlatformOwned: row.isPlatformOwned,
    reason: "",
  };
}
export function AdminChannels({ initialQuery = "" }: { initialQuery?: string }) {
  const { locale, href, formatNumber, formatDate } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [applied, setApplied] = useState({ query: initialQuery, status: "" });
  const [snapshot, setSnapshot] = useState<AdminChannelsSnapshot | null>(null),
    [query, setQuery] = useState(initialQuery),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [drafts, setDrafts] = useState<Record<string, RetainedDraft>>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [readError, setReadError] = useState(false),
    [denied, setDenied] = useState(false),
    [notice, setNotice] = useState<
      "saved" | "uncertain" | "invalid" | "conflict" | "verification" | null
    >(null),
    [ack, setAck] = useState<AdminChannelRecord | null>(null),
    [reviewTarget, setReviewTarget] = useState<string | null>(null),
    [reviewed, setReviewed] = useState(false),
    [currentRecord, setCurrentRecord] = useState<AdminChannelRecord | null>(null),
    [recordRead, setRecordRead] = useState(false);
  const actor = useRef<AdminSession | null>(null),
    read = useRef<AbortController | null>(null),
    write = useRef<AbortController | null>(null),
    operation = useRef(false),
    decisionLocked = useRef(false),
    dirty = useRef(false),
    retained = useRef<Record<string, RetainedDraft>>({});
  const clearActor = useCallback(() => {
    actor.current = null;
    retained.current = {};
    setDrafts({});
    setSnapshot(null);
    setAck(null);
    setCurrentRecord(null);
    setReviewTarget(null);
    setDenied(true);
    decisionLocked.current = true;
    setLocked(true);
    setReviewed(false);
  }, []);
  const load = useCallback(
    async (input: { query: string; status: string; page: number }) => {
      if (operation.current) return;
      read.current?.abort();
      const controller = new AbortController();
      read.current = controller;
      setLoading(true);
      setSnapshot(null);
      setReadError(false);
      setDenied(false);
      try {
        const result = await getAdminChannels(input, controller.signal, actor.current ?? undefined);
        if (controller.signal.aborted) return;
        actor.current = result.session;
        setSnapshot(result);
        setApplied({ query: input.query, status: input.status });
        setPage(result.directory.pagination.page);
        const next = { ...retained.current };
        for (const row of result.directory.items)
          if (!next[row.id]?.dirty) next[row.id] = { base: row, value: initial(row), dirty: false };
        retained.current = next;
        setDrafts(next);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AdminChannelsError && [401, 403].includes(error.status)) clearActor();
        else setReadError(true);
      } finally {
        if (read.current === controller) {
          read.current = null;
          setLoading(false);
        }
      }
    },
    [clearActor],
  );
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load({ query: initialQuery, status: "", page: 1 });
    });
    const hide = () => {
      read.current?.abort();
      write.current?.abort();
      setSnapshot(null);
      setCurrentRecord(null);
      setLoading(false);
      setBusy(false);
      decisionLocked.current = true;
      setLocked(true);
      setReviewed(false);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setReadError(true);
        setRecordRead(false);
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      active = false;
      const pendingRead = read.current,
        pendingWrite = write.current;
      read.current = null;
      write.current = null;
      pendingRead?.abort();
      pendingWrite?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [initialQuery, load]);
  useEffect(() => {
    dirty.current = Object.values(drafts).some((d) => d.dirty) || busy || locked;
  }, [drafts, busy, locked]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        !dirty.current
      )
        return;
      const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!a || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
      const raw = a.getAttribute("href");
      if (!raw || raw.startsWith("#")) return;
      if (
        !window.confirm(
          ar
            ? "هناك مسودة أو عملية تحتاج المراجعة. هل تريد المغادرة؟"
            : "A draft or operation still needs review. Leave this page?",
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [ar]);
  function edit(id: string, patch: Partial<AdminChannelDraft>) {
    const old = retained.current[id];
    if (!old) return;
    const next = {
      ...retained.current,
      [id]: { ...old, value: { ...old.value, ...patch }, dirty: true },
    };
    retained.current = next;
    setDrafts(next);
    dirty.current = true;
  }
  async function save(id: string) {
    const session = actor.current,
      draft = retained.current[id];
    if (!session || !draft || operation.current || decisionLocked.current || read.current) return;
    try {
      adminChannelInput(draft.base, draft.value);
    } catch {
      setNotice("invalid");
      return;
    }
    operation.current = true;
    decisionLocked.current = true;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setLocked(true);
    setReviewed(false);
    setRecordRead(false);
    setCurrentRecord(null);
    setReviewTarget(id);
    setNotice(null);
    try {
      const result = await saveAdminChannel(session, draft.base, draft.value, controller.signal);
      if (controller.signal.aborted) return;
      setAck(result);
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              directory: {
                ...previous.directory,
                items: previous.directory.items.map((row) =>
                  row.id === result.id ? { ...row, ...result } : row,
                ),
              },
            }
          : null,
      );
      setNotice("saved");
      const next = {
        ...retained.current,
        [id]: { base: result, value: initial(result), dirty: false },
      };
      retained.current = next;
      setDrafts(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AdminChannelsError && error.verificationRequired) {
        decisionLocked.current = false;
        setLocked(false);
        setNotice("verification");
      } else if (error instanceof AdminChannelsError && !error.writeStarted) {
        if ([401, 403].includes(error.status)) clearActor();
        else {
          decisionLocked.current = false;
          setLocked(false);
          setNotice("invalid");
        }
      } else
        setNotice(
          error instanceof AdminChannelsError && error.status === 409 ? "conflict" : "uncertain",
        );
    } finally {
      if (write.current === controller) {
        write.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function review() {
    const session = actor.current;
    if (!session || !reviewTarget || operation.current || read.current) return;
    const target = reviewTarget;
    operation.current = true;
    const controller = new AbortController();
    read.current = controller;
    setBusy(true);
    setReadError(false);
    setCurrentRecord(null);
    setRecordRead(false);
    setReviewed(false);
    try {
      const result = await reviewAdminChannel(session, target, controller.signal);
      if (controller.signal.aborted) return;
      setCurrentRecord(result);
      setRecordRead(true);
      setReviewed(true);
      if (result) {
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                directory: {
                  ...previous.directory,
                  items: previous.directory.items.map((row) =>
                    row.id === result.id ? { ...row, ...result } : row,
                  ),
                },
              }
            : null,
        );
        const old = retained.current[target];
        if (old) {
          const next = { ...retained.current, [target]: { ...old, base: result } };
          retained.current = next;
          setDrafts(next);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AdminChannelsError && [401, 403].includes(error.status)) clearActor();
      else setReadError(true);
    } finally {
      if (read.current === controller) {
        read.current = null;
        operation.current = false;
        setBusy(false);
      }
    }
  }
  const disabled = busy || loading || locked || !snapshot;
  const status = (value: string) =>
    ({
      ACTIVE: copy("Active", "نشط"),
      HIDDEN: copy("Hidden", "مخفي"),
      SUSPENDED: copy("Suspended", "موقوف"),
      REMOVED: copy("Removed", "مزال"),
      PENDING: copy("Pending", "قيد الانتظار"),
      ENDED: copy("Ended", "منتهٍ"),
    })[value] ?? value;
  const saved = (row: AdminChannelRecord) => (
    <dl className={styles.facts}>
      <dt>{copy("Name", "الاسم")}</dt>
      <dd dir="auto">{row.name}</dd>
      <dt>{copy("Description", "الوصف")}</dt>
      <dd className={styles.prose} dir="auto">
        {row.description ?? copy("No description", "بلا وصف")}
      </dd>
      <dt>{copy("Status / platform ownership", "الحالة / ملكية المنصة")}</dt>
      <dd>
        {status(row.status)} ·{" "}
        {row.isPlatformOwned
          ? copy("AYIN-owned", "مملوكة لـ AYIN")
          : copy("Creator-owned", "مملوكة للمنشئ")}
      </dd>
      <dt>{copy("Latest contract", "أحدث عقد")}</dt>
      <dd>
        {row.creatorContracts[0]
          ? `${status(row.creatorContracts[0].status)} · ${row.creatorContracts[0].revenueShareBps === null ? copy("Platform default share", "نسبة المنصة الافتراضية") : copy(`${row.creatorContracts[0].revenueShareBps} basis points`, `${formatNumber(row.creatorContracts[0].revenueShareBps)} نقطة أساس`)}`
          : copy("No contract record", "لا يوجد سجل عقد")}
      </dd>
      <dt>{copy("Updated · UTC", "آخر تعديل · UTC")}</dt>
      <dd>
        {formatDate(row.updatedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}
      </dd>
    </dl>
  );
  function form(id: string, draft: RetainedDraft) {
    const row = draft.base,
      v = draft.value;
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(id);
        }}
      >
        <FormSection
          id={`channel-form-${id}`}
          legend={copy(`Edit @${row.handle}`, `تعديل @${row.handle}`)}
          disabled={disabled}
        >
          <TextField
            id={`channel-name-${id}`}
            label={copy("Channel name", "اسم القناة")}
            value={v.name}
            required
            maxLength={120}
            onChange={(e) => edit(id, { name: e.target.value })}
          />
          <TextAreaField
            id={`channel-description-${id}`}
            label={copy("Description", "الوصف")}
            value={v.description}
            maxLength={20000}
            onChange={(e) => edit(id, { description: e.target.value })}
          />
          <label htmlFor={`channel-status-${id}`}>{copy("Channel status", "حالة القناة")}</label>
          <select
            id={`channel-status-${id}`}
            value={v.status}
            onChange={(e) => edit(id, { status: e.target.value as AdminChannelDraft["status"] })}
          >
            {channelStates
              .filter((s) => s !== "REMOVED" || v.status === "REMOVED")
              .map((s) => (
                <option key={s} value={s} disabled={s === "REMOVED"}>
                  {status(s)}
                </option>
              ))}
          </select>
          <label htmlFor={`channel-contract-${id}`}>
            {copy("Creator monetization", "تحقيق ربح المنشئ")}
          </label>
          <select
            id={`channel-contract-${id}`}
            value={v.contractStatus}
            onChange={(e) =>
              edit(id, { contractStatus: e.target.value as AdminChannelDraft["contractStatus"] })
            }
          >
            {contractStates.map((s) => (
              <option key={s} value={s}>
                {status(s)}
              </option>
            ))}
          </select>
          <TextField
            id={`channel-share-${id}`}
            label={copy("Revenue share · basis points", "نسبة الأرباح · نقاط أساس")}
            hint={copy(
              "Blank retains the platform default; zero is an explicit zero share.10000 means100%.",
              "الفراغ يعني النسبة الافتراضية للمنصة؛ الصفر نسبة صفر صريحة. ١٠٠٠٠ تعني ١٠٠٪.",
            )}
            inputMode="numeric"
            pattern="[0-9]*"
            value={v.revenueShareBps}
            onChange={(e) => edit(id, { revenueShareBps: e.target.value })}
          />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={v.isPlatformOwned}
              onChange={(e) => edit(id, { isPlatformOwned: e.target.checked })}
            />
            {copy("AYIN platform-owned channel", "قناة مملوكة لمنصة AYIN")}
          </label>
          <TextAreaField
            id={`channel-reason-${id}`}
            label={copy("Actual audit reason", "سبب التدقيق الفعلي")}
            value={v.reason}
            required
            minLength={3}
            maxLength={500}
            onChange={(e) => edit(id, { reason: e.target.value })}
          />
          <ActionButton type="submit">{copy("Save channel", "حفظ القناة")}</ActionButton>
        </FormSection>
      </form>
    );
  }
  const hiddenDrafts = Object.entries(drafts).filter(
    ([id, d]) => d.dirty && !snapshot?.directory.items.some((row) => row.id === id),
  );
  return (
    <section className={styles.workspace}>
      <PageHeader
        title={copy("Channels & Creators", "القنوات والمنشئون")}
        description={copy(
          "Review channel state, ownership and actual creator contracts before an audited update.",
          "راجع حالة القناة وملكيتها وعقود المنشئ الفعلية قبل تعديل مُدقّق.",
        )}
        actions={
          <Link href={href("/admin/content")}>
            {copy("Open Content Library", "فتح مكتبة المحتوى")}
          </Link>
        }
      />
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          void load({ query, status: filter, page: 1 });
        }}
      >
        <TextField
          id="admin-channel-search"
          label={copy("Search channels", "البحث في القنوات")}
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div>
          <label htmlFor="admin-channel-filter">{copy("Filter channels", "تصفية القنوات")}</label>
          <select
            id="admin-channel-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">{copy("All except removed", "الكل عدا المزال")}</option>
            {channelStates.map((s) => (
              <option key={s} value={s}>
                {status(s)}
              </option>
            ))}
          </select>
        </div>
        <ActionButton tone="secondary" type="submit" disabled={busy || loading}>
          {copy("Review channel directory", "مراجعة دليل القنوات")}
        </ActionButton>
      </form>
      {loading && (
        <StatusNotice announce="polite">
          {copy("Loading channel directory…", "جارٍ تحميل دليل القنوات…")}
        </StatusNotice>
      )}
      {readError && (
        <StatusNotice tone="danger" announce="assertive">
          {copy(
            "Current records could not be verified. Retry the explicit review; retained drafts and saved acknowledgments remain separate.",
            "تعذر التحقق من السجلات الحالية. أعد المراجعة؛ تظل المسودات وتأكيدات الحفظ منفصلة.",
          )}
        </StatusNotice>
      )}
      {denied && (
        <StatusNotice tone="danger" announce="assertive">
          {copy(
            "Operations access or the current staff identity could not be verified. Reopen after verification.",
            "تعذر التحقق من صلاحية التشغيل أو هوية الموظف الحالية. افتح الصفحة مجددًا بعد التحقق.",
          )}
        </StatusNotice>
      )}
      {notice && (
        <StatusNotice announce="polite" tone={notice === "saved" ? "success" : "warning"}>
          {notice === "saved"
            ? copy(
                "Channel and actual contract acknowledged. Review the target before another write.",
                "تم تأكيد القناة والعقد الفعلي. راجع القناة قبل تعديل آخر.",
              )
            : notice === "verification"
              ? copy(
                  "Verify your session, review the retained draft and submit it explicitly. No update was accepted or replayed.",
                  "تحقق من الجلسة، وراجع المسودة المحفوظة ثم أرسلها صراحةً. لم يُقبل تعديل ولم يُعد إرساله.",
                )
              : notice === "invalid"
                ? copy(
                    "Check the draft values and actual reason; no update was started.",
                    "راجع بيانات المسودة والسبب الفعلي؛ لم يبدأ التعديل.",
                  )
                : notice === "conflict"
                  ? copy(
                      "The channel changed since your draft. No stale overwrite was accepted. Review the current record and decide explicitly.",
                      "تغيّرت القناة منذ مسودتك. لم يُقبل التعديل القديم. راجع السجل الحالي واتخذ قرارك.",
                    )
                  : copy(
                      "The update response was not confirmed. The draft is retained and will not be replayed. Review the actual target.",
                      "لم يتأكد رد التعديل. احتفظنا بالمسودة ولن نعيد إرسالها. راجع القناة الفعلية.",
                    )}
        </StatusNotice>
      )}
      {ack && (
        <Disclosure open summary={copy("Acknowledged channel update", "تعديل القناة المؤكد")}>
          <bdi>
            @{ack.handle} · {ack.id}
          </bdi>
          {saved(ack)}
        </Disclosure>
      )}
      {locked && (
        <StatusNotice tone="warning">
          <p>
            {copy(
              "Writes are locked until a current-target read and explicit next-decision acknowledgment. Review does not overwrite your unsaved form.",
              "التعديلات مقفلة حتى قراءة القناة الحالية والإقرار بالقرار التالي. لا تستبدل المراجعة بيانات المسودة.",
            )}
          </p>
          <div className={styles.actions}>
            <ActionButton
              tone="secondary"
              disabled={!reviewTarget || busy || loading}
              onClick={() => void review()}
            >
              {copy("Review current channel", "مراجعة القناة الحالية")}
            </ActionButton>
            <ActionButton
              tone="secondary"
              disabled={!reviewed || !currentRecord || busy || loading}
              onClick={() => {
                decisionLocked.current = false;
                setLocked(false);
                setNotice(null);
              }}
            >
              {copy(
                "I reviewed the channel; enable the next update",
                "راجعت القناة؛ فعّل التعديل التالي",
              )}
            </ActionButton>
          </div>
          {recordRead &&
            (currentRecord ? (
              saved(currentRecord)
            ) : (
              <p>
                {copy(
                  "The protected read returned404. This observation is not proof of deletion or absence of a previous update.",
                  "أعادت القراءة المحمية ٤٠٤. لا يثبت ذلك الحذف أو غياب تعديل سابق.",
                )}
              </p>
            ))}
        </StatusNotice>
      )}
      {snapshot && (
        <>
          <MetricList
            label={copy("Channel directory snapshot", "قراءة دليل القنوات")}
            items={[
              {
                label: copy("Matching channels", "القنوات المطابقة"),
                value: formatNumber(snapshot.directory.pagination.total),
              },
              {
                label: copy("Returned this page", "المسترجع في هذه الصفحة"),
                value: formatNumber(snapshot.directory.items.length),
              },
            ]}
          />
          <p>
            {copy(
              "25 database rows per page, ordered by creation time and ID. Counts and pages can change as other staff update records; drafts stay with their channel ID.",
              "٢٥ صفًا من قاعدة البيانات لكل صفحة، بترتيب الإنشاء والمعرّف. قد تتغير الأعداد والصفحات بتعديلات الآخرين؛ تبقى كل مسودة مرتبطة بمعرّف قناتها.",
            )}
          </p>
          <ul className={styles.list}>
            {snapshot.directory.items.map((row) => {
              const draft = drafts[row.id];
              return (
                <li key={row.id}>
                  <header>
                    <h2>
                      <bdi>@{row.handle}</bdi> · <span dir="auto">{row.name}</span>
                    </h2>
                    <DataBadge>{status(row.status)}</DataBadge>
                  </header>
                  <p dir="auto">
                    {row.members[0]?.account.email ?? copy("No owner record", "بلا سجل مالك")} ·{" "}
                    {formatNumber(row._count.videos)} {copy("videos", "فيديوهات")} ·{" "}
                    {formatNumber(row._count.subscriptions)} {copy("subscribers", "مشتركين")} ·{" "}
                    {formatNumber(row._count.playlists)} {copy("playlists", "قوائم تشغيل")}
                  </p>
                  <p>
                    {row.primaryTvChannel
                      ? `${row.primaryTvChannel.name} · ${row.primaryTvChannel.status}`
                      : copy("No primary TV record", "بلا سجل تلفزيون رئيسي")}
                  </p>
                  <Disclosure summary={copy("Current saved channel", "القناة المحفوظة الحالية")}>
                    {saved(row)}
                  </Disclosure>
                  {draft && (
                    <Disclosure summary={copy(`Edit @${row.handle}`, `تعديل @${row.handle}`)}>
                      {form(row.id, draft)}
                    </Disclosure>
                  )}
                </li>
              );
            })}
          </ul>
          {snapshot.directory.items.length === 0 && (
            <p>
              {copy("No matching channels in this page.", "لا توجد قنوات مطابقة في هذه الصفحة.")}
            </p>
          )}
          <PageControls
            label={copy("Channel pages", "صفحات القنوات")}
            summary={`${copy("Page", "الصفحة")} ${formatNumber(page)} / ${formatNumber(snapshot.directory.pagination.pages)}`}
            previousLabel={copy("Previous", "السابق")}
            nextLabel={copy("Next", "التالي")}
            hasPrevious={page > 1 && !busy && !loading}
            hasNext={
              page < Math.min(snapshot.directory.pagination.pages, 1000) && !busy && !loading
            }
            onPrevious={() => void load({ ...applied, page: page - 1 })}
            onNext={() => void load({ ...applied, page: page + 1 })}
          />
        </>
      )}
      {hiddenDrafts.length > 0 && (
        <Disclosure
          summary={copy(
            "Retained drafts outside the current page",
            "المسودات المحتفظ بها خارج الصفحة الحالية",
          )}
        >
          {hiddenDrafts.map(([id, draft]) => (
            <section key={id}>
              <h2>
                <bdi>@{draft.base.handle}</bdi>
              </h2>
              {form(id, draft)}
            </section>
          ))}
        </Disclosure>
      )}
    </section>
  );
}
