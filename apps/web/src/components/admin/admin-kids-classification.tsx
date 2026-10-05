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
import { PageControls } from "@/components/ui/data-presentation";
import type { AdminSession } from "@/lib/admin-control";
import {
  getAdminVideos,
  type AdminVideoSnapshot,
  type AdminVideoRecord,
  type VideoFilters,
} from "@/lib/admin-video-workspace";
import {
  AdminKidsError,
  AdminKidsWriteError,
  readKidsPolicy,
  saveKidsClassification,
  contradictoryClassification,
  type ClassificationDraft,
  type KidsPolicy,
} from "@/lib/admin-kids-classification";
import styles from "./admin-record-workspace.module.css";
import kidsStyles from "./admin-kids-classification.module.css";

const initialFilters: VideoFilters = { query: "", status: "", visibility: "", page: 1 };
const emptyDraft = (): ClassificationDraft => ({
  maturityLevel: "GENERAL",
  ageRestriction: "NONE",
  kidsEligible: false,
  reason: "",
});
type Failure = "directory" | "policy" | "denied" | "verification" | "uncertain" | null;
export function AdminKidsClassification() {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [snapshot, setSnapshot] = useState<AdminVideoSnapshot | null>(null);
  const [selected, setSelected] = useState<AdminVideoRecord | null>(null);
  const [policy, setPolicy] = useState<KidsPolicy | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [failure, setFailure] = useState<Failure>(null);
  const [loading, setLoading] = useState<"directory" | "policy" | "save" | null>(null);
  const [locked, setLocked] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [saved, setSaved] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [publicAcknowledgment, setPublicAcknowledgment] = useState(false);
  const actor = useRef<AdminSession | null>(null),
    request = useRef<AbortController | null>(null),
    writing = useRef(false),
    dirty = useRef(false),
    workspace = useRef<HTMLDivElement | null>(null),
    privateBody = useRef<HTMLDivElement | null>(null),
    editorHeading = useRef<HTMLHeadingElement | null>(null);
  const resetTarget = useCallback(() => {
    setPublicAcknowledgment(false);
    setSelected(null);
    setPolicy(null);
    setDraft(emptyDraft());
    setSaved(false);
    setLocked(false);
    setReviewed(false);
    dirty.current = false;
  }, []);
  const conceal = useCallback(
    (denied = false) => {
      request.current?.abort();
      request.current = null;
      writing.current = false;
      if (privateBody.current) privateBody.current.hidden = true;
      // Scrub native values synchronously, including detached controls captured before React removes them.
      for (const field of workspace.current?.querySelectorAll("input, textarea") ?? []) {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = "";
          field.defaultValue = "";
          if (field instanceof HTMLInputElement) {
            field.checked = false;
            field.defaultChecked = false;
          }
        }
      }
      for (const select of workspace.current?.querySelectorAll("select") ?? []) {
        for (const option of select.options) {
          option.selected = false;
          option.defaultSelected = false;
        }
        select.selectedIndex = -1;
      }
      setQuery("");
      setFilters(initialFilters);
      setSnapshot(null);
      resetTarget();
      setLoading(null);
      setFailure(denied ? "denied" : "directory");
      if (denied) actor.current = null;
    },
    [resetTarget],
  );
  const loadDirectory = useCallback(
    async (next: VideoFilters) => {
      if (writing.current) return;
      request.current?.abort();
      const pending = new AbortController();
      request.current = pending;
      setSnapshot(null);
      resetTarget();
      setLoading("directory");
      setFailure(null);
      setFilters(next);
      try {
        const result = await getAdminVideos(next, pending.signal, actor.current ?? undefined);
        if (pending.signal.aborted || request.current !== pending) return;
        actor.current = result.session;
        setSnapshot(result);
        setGeneration((v) => v + 1);
      } catch (error) {
        if (pending.signal.aborted || request.current !== pending) return;
        if (error instanceof AdminKidsError && [401, 403, 409].includes(error.status))
          conceal(true);
        else setFailure("directory");
      } finally {
        if (request.current === pending) {
          request.current = null;
          setLoading(null);
        }
      }
    },
    [conceal, resetTarget],
  );
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadDirectory(initialFilters);
    });
    const hide = () => conceal();
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      request.current?.abort();
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [loadDirectory, conceal]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current || writing.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        (!dirty.current && !writing.current) ||
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
            ? "لديك مسودة تصنيف أو عملية لم تتأكد. هل تريد المغادرة؟"
            : "You have a classification draft or an unconfirmed operation. Leave this page?",
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
  useEffect(() => {
    editorHeading.current?.focus();
  }, [selected]);
  function canLeave() {
    return (
      !dirty.current ||
      window.confirm(
        copy(
          "Discard this classification draft and choose another video?",
          "هل تريد تجاهل مسودة التصنيف واختيار فيديو آخر؟",
        ),
      )
    );
  }
  function choose(record: AdminVideoRecord) {
    if (writing.current || !canLeave()) return;
    request.current?.abort();
    request.current = null;
    resetTarget();
    setSelected(record);
    setLoading(null);
    setFailure(null);
  }
  async function loadPolicy() {
    if (writing.current || !actor.current || !selected) return;
    request.current?.abort();
    const pending = new AbortController();
    request.current = pending;
    setLoading("policy");
    setFailure(null);
    setPolicy(null);
    setReviewed(false);
    try {
      const result = await readKidsPolicy(actor.current, selected.id, pending.signal);
      if (pending.signal.aborted || request.current !== pending) return;
      setPolicy(result);
      setReviewed(true);
      if (!dirty.current)
        setDraft({
          maturityLevel: result.maturityLevel ?? "GENERAL",
          ageRestriction: result.ageRestriction,
          kidsEligible: result.kidsEligible,
          reason: "",
        });
    } catch (error) {
      if (pending.signal.aborted || request.current !== pending) return;
      if (error instanceof AdminKidsError && [401, 403, 409].includes(error.status)) conceal(true);
      else setFailure("policy");
    } finally {
      if (request.current === pending) {
        request.current = null;
        setLoading(null);
      }
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      writing.current ||
      loading ||
      locked ||
      !policy ||
      !selected ||
      selected.status === "REMOVED" ||
      !actor.current ||
      contradictoryClassification(draft) ||
      draft.reason.trim().length < 5
    )
      return;
    writing.current = true;
    dirty.current = true;
    const pending = new AbortController();
    request.current = pending;
    setLoading("save");
    setFailure(null);
    setSaved(false);
    setLocked(true);
    setReviewed(false);
    try {
      const result = await saveKidsClassification(
        actor.current,
        selected.id,
        draft,
        pending.signal,
      );
      if (pending.signal.aborted || request.current !== pending) return;
      setPolicy(result);
      setDraft((current) => ({ ...current, reason: "" }));
      setSaved(true);
      setLocked(false);
      dirty.current = false;
    } catch (error) {
      if (pending.signal.aborted || request.current !== pending) return;
      if (error instanceof AdminKidsWriteError && error.acknowledged) {
        conceal([401, 403, 409].includes(error.status));
        setPublicAcknowledgment(true);
      } else if (error instanceof AdminKidsError && error.verificationRequired)
        setFailure("verification");
      else if (error instanceof AdminKidsError && [401, 403, 409].includes(error.status))
        conceal(true);
      else setFailure("uncertain");
    } finally {
      if (request.current === pending) {
        request.current = null;
        writing.current = false;
        setLoading(null);
      }
    }
  }
  function edit(value: Partial<ClassificationDraft>) {
    dirty.current = true;
    setSaved(false);
    setDraft((current) => ({ ...current, ...value }));
  }
  const maturity = (value: KidsPolicy["maturityLevel"]) =>
    value === null
      ? copy("Unclassified", "غير مصنّف")
      : value === "GENERAL"
        ? copy("General audience", "جميع الأعمار")
        : value === "TEEN"
          ? copy("Teen", "للمراهقين")
          : copy("Mature", "للبالغين");
  const age = (value: ClassificationDraft["ageRestriction"]) =>
    value === "NONE"
      ? copy("No age restriction", "دون قيد عمري")
      : value === "AGE_13_PLUS"
        ? copy("13 and older", "١٣ عامًا فأكثر")
        : copy("18 and older", "١٨ عامًا فأكثر");
  const stateLabels = {
    DRAFT: copy("Draft", "مسودة"),
    UPLOADING: copy("Uploading", "قيد الرفع"),
    VALIDATING: copy("Processing", "قيد المعالجة"),
    SCHEDULED: copy("Scheduled", "مجدول"),
    PUBLISHED: copy("Published", "منشور"),
    REMOVED: copy("Removed", "مُزال"),
  };
  const visibilityLabels = {
    PUBLIC: copy("Public", "عام"),
    UNLISTED: copy("Unlisted", "غير مدرج"),
    PRIVATE: copy("Private", "خاص"),
  };
  return (
    <div ref={workspace} className={styles.workspace}>
      <PageHeader
        level={1}
        eyebrow={copy("Content safety", "سلامة المحتوى")}
        title={copy("Kids classification", "تصنيف محتوى الأطفال")}
        description={copy(
          "Choose a video, read its current classification, then record your reviewed decision. Unclassified content is excluded from Kids.",
          "اختر فيديو واقرأ تصنيفه الحالي، ثم سجّل قرارك بعد المراجعة. المحتوى غير المصنّف مستبعد من قسم الأطفال.",
        )}
      />
      {publicAcknowledgment ? (
        <StatusNotice tone="success" announce="polite">
          {copy(
            "Classification saved and audited. Private details are hidden until access is verified again.",
            "تم حفظ التصنيف وتسجيله في سجل التدقيق. التفاصيل الخاصة مخفية حتى التحقق من الوصول مجددًا.",
          )}
        </StatusNotice>
      ) : null}
      {failure === "denied" ? (
        <StatusNotice tone="danger" announce="polite">
          {copy(
            "Your account, permissions or selected video changed or became unavailable. Reload the video directory to verify access.",
            "تغيّر الحساب أو الصلاحيات أو الفيديو المحدّد، أو لم يعد متاحًا. أعد تحميل دليل الفيديوهات للتحقق من الوصول.",
          )}
        </StatusNotice>
      ) : null}
      {failure === "directory" ? (
        <StatusNotice tone="danger" announce="polite">
          {copy(
            "The video directory could not be verified. No results are shown.",
            "تعذر التحقق من دليل الفيديوهات. لا تُعرض أي نتائج.",
          )}
        </StatusNotice>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canLeave()) void loadDirectory({ ...initialFilters, query });
        }}
      >
        <FormSection
          id="kids-search"
          legend={copy("Find a video", "البحث عن فيديو")}
          layout="inline"
          disabled={loading === "save"}
        >
          <TextField
            id="kids-video-search"
            label={copy("Search by video or channel name", "البحث باسم الفيديو أو القناة")}
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            dir="auto"
          />
          <ActionButton type="submit" disabled={loading === "directory"}>
            {copy("Search videos", "البحث عن الفيديوهات")}
          </ActionButton>
          {failure === "directory" || failure === "denied" ? (
            <ActionButton onClick={() => void loadDirectory(filters)}>
              {copy("Retry directory", "إعادة تحميل الدليل")}
            </ActionButton>
          ) : null}
        </FormSection>
      </form>
      {loading ? (
        <StatusNotice announce="polite">
          {loading === "directory"
            ? copy("Loading videos…", "جارٍ تحميل الفيديوهات…")
            : loading === "policy"
              ? copy("Reading current classification…", "جارٍ قراءة التصنيف الحالي…")
              : copy("Saving reviewed classification…", "جارٍ حفظ التصنيف بعد المراجعة…")}
        </StatusNotice>
      ) : null}
      <div key={generation} ref={privateBody} className={styles.privateBody}>
        {selected ? (
          <section
            className={styles.record}
            data-testid="kids-classification-editor"
            aria-label={copy("Selected video classification", "تصنيف الفيديو المحدّد")}
          >
            <h2 ref={editorHeading} tabIndex={-1}>
              {copy("Review classification", "مراجعة التصنيف")}
            </h2>
            <strong className={kidsStyles.identity} dir="auto">
              {selected.title}
            </strong>
            <span className={kidsStyles.identity} dir="auto">
              {selected.channel.name} · @{selected.channel.handle}
            </span>
            <small>
              <bdi>{selected.id}</bdi>
            </small>
            <p>
              {copy(
                "Read the current policy before editing. Kids eligibility requires a general audience and no age restriction. Every save is audited; rights and availability still apply.",
                "اقرأ السياسة الحالية قبل التعديل. أهلية الأطفال تتطلب ملاءمة جميع الأعمار وعدم وجود قيد عمري. يُسجّل كل حفظ في سجل التدقيق؛ وتظل الحقوق والإتاحة سارية.",
              )}
            </p>
            {selected.status === "REMOVED" ? (
              <StatusNotice tone="warning">
                {copy(
                  "This video is removed. Its policy is read-only; classification changes are unavailable.",
                  "هذا الفيديو مُزال. سياسته للقراءة فقط، وتعديل التصنيف غير متاح.",
                )}
              </StatusNotice>
            ) : null}
            <ActionButton disabled={Boolean(loading)} onClick={() => void loadPolicy()}>
              {copy("Read current classification", "قراءة التصنيف الحالي")}
            </ActionButton>
            {failure === "policy" ? (
              <StatusNotice tone="danger" announce="polite">
                {copy(
                  "The current policy could not be verified. Retry reading it before saving.",
                  "تعذر التحقق من السياسة الحالية. أعد قراءتها قبل الحفظ.",
                )}
              </StatusNotice>
            ) : null}
            {failure === "verification" ? (
              <StatusNotice tone="warning" announce="polite">
                {copy(
                  "Verify your session, then read the current classification and review your retained draft. Nothing will be retried automatically.",
                  "تحقق من جلستك، ثم اقرأ التصنيف الحالي وراجع المسودة المحفوظة. لن تُعاد المحاولة تلقائيًا.",
                )}
              </StatusNotice>
            ) : null}
            {failure === "uncertain" ? (
              <StatusNotice tone="warning" announce="polite">
                {copy(
                  "The save was not confirmed. Read the current classification and review your retained draft before another attempt.",
                  "لم يتأكد الحفظ. اقرأ التصنيف الحالي وراجع المسودة المحفوظة قبل محاولة أخرى.",
                )}
              </StatusNotice>
            ) : null}
            {saved ? (
              <StatusNotice tone="success" announce="polite">
                {copy(
                  "Classification saved and audited.",
                  "تم حفظ التصنيف وتسجيله في سجل التدقيق.",
                )}
              </StatusNotice>
            ) : null}
            {policy ? (
              <>
                <StatusNotice>
                  <span data-testid="kids-current-policy">
                    {copy("Current classification: ", "التصنيف الحالي: ")}
                    {maturity(policy.maturityLevel)} · {age(policy.ageRestriction)} ·{" "}
                    {policy.kidsEligible
                      ? copy(
                          "Eligible for Kids, subject to rights and availability",
                          "مؤهل للأطفال، وفقًا للحقوق والإتاحة",
                        )
                      : copy("Excluded from Kids", "مستبعد من قسم الأطفال")}
                  </span>
                </StatusNotice>
                {locked && selected.status !== "REMOVED" ? (
                  <ActionButton
                    disabled={!reviewed || Boolean(loading)}
                    onClick={() => {
                      setLocked(false);
                      setFailure(null);
                    }}
                  >
                    {copy(
                      "I reviewed the current policy; enable my draft",
                      "راجعت السياسة الحالية؛ تفعيل المسودة",
                    )}
                  </ActionButton>
                ) : null}
                {selected.status !== "REMOVED" ? (
                  <form onSubmit={(event) => void save(event)}>
                    <FormSection
                      id="kids-decision"
                      legend={copy("Classification decision", "قرار التصنيف")}
                      disabled={Boolean(loading) || locked}
                    >
                      <SelectField
                        id="kids-maturity"
                        label={copy("Maturity", "الفئة العمرية")}
                        value={draft.maturityLevel}
                        onChange={(event) =>
                          edit({
                            maturityLevel: event.target
                              .value as ClassificationDraft["maturityLevel"],
                          })
                        }
                      >
                        <option value="GENERAL">{maturity("GENERAL")}</option>
                        <option value="TEEN">{maturity("TEEN")}</option>
                        <option value="MATURE">{maturity("MATURE")}</option>
                      </SelectField>
                      <SelectField
                        id="kids-age"
                        label={copy("Age restriction", "القيد العمري")}
                        value={draft.ageRestriction}
                        onChange={(event) =>
                          edit({
                            ageRestriction: event.target
                              .value as ClassificationDraft["ageRestriction"],
                          })
                        }
                      >
                        <option value="NONE">{age("NONE")}</option>
                        <option value="AGE_13_PLUS">{age("AGE_13_PLUS")}</option>
                        <option value="AGE_18_PLUS">{age("AGE_18_PLUS")}</option>
                      </SelectField>
                      <label className={styles.choice}>
                        <input
                          type="checkbox"
                          checked={draft.kidsEligible}
                          onChange={(event) => edit({ kidsEligible: event.target.checked })}
                        />
                        {copy("Explicitly eligible for AYIN Kids", "مؤهل صراحةً لقسم أطفال AYIN")}
                      </label>
                      <TextAreaField
                        id="kids-reason"
                        label={copy(
                          "Audit reason (5–1000 characters)",
                          "سبب القرار للتدقيق (٥–١٠٠٠ حرف)",
                        )}
                        dir="auto"
                        minLength={5}
                        maxLength={1000}
                        required
                        value={draft.reason}
                        onChange={(event) => edit({ reason: event.target.value })}
                      />
                      {contradictoryClassification(draft) ? (
                        <StatusNotice tone="danger">
                          {copy(
                            "Kids eligibility requires a general audience and no age restriction.",
                            "أهلية الأطفال تتطلب ملاءمة جميع الأعمار وعدم وجود قيد عمري.",
                          )}
                        </StatusNotice>
                      ) : null}
                      <ActionButton
                        type="submit"
                        disabled={
                          contradictoryClassification(draft) || draft.reason.trim().length < 5
                        }
                      >
                        {copy("Save reviewed classification", "حفظ التصنيف بعد المراجعة")}
                      </ActionButton>
                    </FormSection>
                  </form>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}
        {snapshot ? (
          <section
            className={`${styles.record} ${kidsStyles.directory}`}
            aria-label={copy("Video results", "نتائج الفيديوهات")}
          >
            <h2>{copy("Select a video", "اختيار فيديو")}</h2>
            <p>
              {copy(
                "Includes drafts and private videos. Selection does not change classification.",
                "يشمل المسودات والفيديوهات الخاصة. الاختيار لا يغيّر التصنيف.",
              )}
            </p>
            {snapshot.directory.items.length ? (
              <ul className={kidsStyles.results}>
                {snapshot.directory.items.map((record) => (
                  <li key={record.id} data-kids-video={record.id} className={kidsStyles.result}>
                    <div className={kidsStyles.metadata}>
                      <strong className={kidsStyles.identity} dir="auto">
                        {record.title}
                      </strong>
                      <span className={`${kidsStyles.identity} ${kidsStyles.channel}`} dir="auto">
                        {record.channel.name} · @{record.channel.handle}
                      </span>
                    </div>
                    <div className={kidsStyles.badges}>
                      <DataBadge>{stateLabels[record.status]}</DataBadge>
                      <DataBadge>{visibilityLabels[record.visibility]}</DataBadge>
                    </div>
                    <ActionButton
                      aria-pressed={selected?.id === record.id}
                      disabled={loading === "save"}
                      onClick={() => choose(record)}
                    >
                      {selected?.id === record.id
                        ? copy("Selected", "محدّد")
                        : copy("Select video", "اختيار الفيديو")}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <StatusNotice>
                {copy("No videos match this search.", "لا توجد فيديوهات مطابقة لهذا البحث.")}
              </StatusNotice>
            )}
            <PageControls
              label={copy("Video result pages", "صفحات نتائج الفيديوهات")}
              summary={copy(
                `Page ${filters.page} of ${snapshot.directory.pagination.pages} · ${snapshot.directory.pagination.total} videos`,
                `الصفحة ${filters.page} من ${snapshot.directory.pagination.pages} · ${snapshot.directory.pagination.total} فيديو`,
              )}
              previousLabel={copy("Previous page", "الصفحة السابقة")}
              nextLabel={copy("Next page", "الصفحة التالية")}
              hasPrevious={!loading && filters.page > 1}
              hasNext={!loading && filters.page < snapshot.directory.pagination.pages}
              onPrevious={() => {
                if (canLeave()) void loadDirectory({ ...filters, page: filters.page - 1 });
              }}
              onNext={() => {
                if (canLeave()) void loadDirectory({ ...filters, page: filters.page + 1 });
              }}
            />
          </section>
        ) : null}
      </div>
      <StatusNotice>
        {copy(
          "Kids uses stricter advertising rules with no personalized targeting or community interactions. This tool does not certify children's privacy compliance; dedicated legal review is still required.",
          "يطبق قسم الأطفال قواعد إعلانية أشد دون استهداف مخصص أو تفاعلات مجتمعية. هذه الأداة لا تصادق على الامتثال لخصوصية الأطفال؛ وتظل المراجعة القانونية المتخصصة مطلوبة.",
        )}
      </StatusNotice>
    </div>
  );
}
