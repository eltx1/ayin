"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { catalogRecord } from "@/lib/catalog-editor-contract";
import {
  catalogDraftCanRestore,
  catalogTargetFingerprint,
  catalogRestorationConflict,
  isCatalogRetainedDraft,
  type CatalogKind,
  type CatalogFormSnapshot,
  type CatalogRetainedDraft,
} from "@/lib/catalog-draft-retention";
import { flushSync } from "react-dom";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { trapDialogTab } from "@/lib/dialog-focus";
import { catalogIdentityFailure } from "@/lib/catalog-editor-contract";
import { apiBaseUrl } from "@/lib/api";
import { readAdminApiError } from "@/lib/admin-reauthentication";
import type { AdminScopeLease } from "@/lib/admin-session-scope";
import { useAdminAccess } from "./admin-access";
import styles from "./catalog-editor-workspace.module.css";

const Scope = createContext<AdminScopeLease | null>(null);
type SaveEntry = { dirty: boolean; save: () => Promise<boolean>; snapshot?: CatalogFormSnapshot };
interface CatalogDraftContext {
  register: (key: string, entry: SaveEntry | null) => void;
  navigate: (action: () => void) => void;
  dirty: boolean;
  registerTarget: (record: unknown, blocked: boolean) => void;
  acknowledgeRecord: (record: unknown) => void;
  clearRestoration: () => void;
  markPending: (pending: boolean, uncertain?: boolean) => void;
  restoredForm: <T>(key: string) => CatalogFormSnapshot<T> | null;
  restoredRecord: <T>() => T | null;
  restoredBlocked: boolean;
}
const Drafts = createContext<CatalogDraftContext | null>(null);

/** Catalog drafts are deliberately memory-only and never survive identity review. */
export function CatalogEditorWorkspace({
  children,
  kind,
}: {
  children: ReactNode;
  kind: CatalogKind;
}) {
  const access = useAdminAccess();
  const { subscribeScopeInvalidation } = access;
  const { locale, direction } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  useLayoutEffect(
    () =>
      subscribeScopeInvalidation(() => {
        if (root.current) concealCatalogDom(root.current);
        redraw((value) => value + 1);
      }),
    [subscribeScopeInvalidation],
  );
  const lease = typeof document === "undefined" ? null : access.getScopeLease();
  return (
    <>
      {!lease ? (
        <StatusNotice announce="polite">
          {access.loading
            ? locale === "ar"
              ? "جارٍ التحقق من صلاحية الإدارة…"
              : "Checking administrative access…"
            : locale === "ar"
              ? "بيانات المكتبة مخفية حتى التحقق من صلاحية الإدارة."
              : "Catalog data is hidden until administrative access is verified."}
          {!access.loading ? (
            <ActionButton onClick={access.refresh}>
              {locale === "ar" ? "التحقق من الصلاحية" : "Verify access"}
            </ActionButton>
          ) : null}
        </StatusNotice>
      ) : null}
      <div ref={root} dir={direction} className={styles.workspace} hidden={!lease} inert={!lease}>
        {lease ? (
          <Scope.Provider value={lease}>
            <CatalogDrafts key={`${kind}:${lease.epoch}`} kind={kind}>
              {children}
            </CatalogDrafts>
          </Scope.Provider>
        ) : null}
      </div>
    </>
  );
}

function CatalogDrafts({ children, kind }: { children: ReactNode; kind: CatalogKind }) {
  const { locale, direction } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const lease = useContext(Scope)!;
  const { getScopedDraft, setScopedDraft, getScopeLease } = useAdminAccess();
  const { request, current } = useCatalogRequest();
  const shelfKey = kind === "movie" ? "catalog-movie" : "catalog-series";
  const [saved] = useState(() => getScopedDraft<unknown>(shelfKey, lease));
  const candidate = isCatalogRetainedDraft(saved, kind) ? saved : null;
  const [reviewNeeded, setReviewNeeded] = useState(saved !== null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewLock = useRef(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewedRecord, setReviewedRecord] = useState<unknown>(null);
  const [restored, setRestored] = useState<{
    forms: Record<string, CatalogFormSnapshot>;
    record: unknown;
    blocked: boolean;
  } | null>(null);
  const restoredRef = useRef(restored);
  const clearRestoration = useCallback(() => {
    // Explicit transitions only; never consume a seed during React initialization.
    restoredRef.current = null;
    setRestored(null);
  }, []);
  const entries = useRef(new Map<string, SaveEntry>());
  const target = useRef<{ record: unknown; pending: boolean; blocked: boolean }>({
    record: null,
    pending: false,
    blocked: false,
  });
  const [dirty, setDirty] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [next, setNext] = useState<(() => void) | null>(null);
  const [leave, setLeave] = useState<string | null>(null);
  const leaveRef = useRef<string | null>(null);
  const allowUnload = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState(false);
  const [, renderAcknowledgement] = useState(0);
  const savingRef = useRef(false);
  const persist = useCallback(() => {
    if (getScopeLease() !== lease) return;
    const changed = [...entries.current.entries()].filter(([, value]) => value.dirty);
    setDirty(changed.length > 0);
    if (!changed.length && !target.current.pending && !target.current.blocked) {
      setScopedDraft(shelfKey, null, lease);
      setOverflow(false);
      return;
    }
    const record = target.current.record as { id?: string; title?: string } | null;
    const value: CatalogRetainedDraft = {
      version: 1,
      kind,
      target: { id: record?.id ?? null, title: record?.title ?? "" },
      targetFingerprint: record ? catalogTargetFingerprint(record) : null,
      forms: Object.fromEntries(
        changed.flatMap(([key, entry]) => (entry.snapshot ? [[key, entry.snapshot]] : [])),
      ),
      pending: target.current.pending,
      blocked: target.current.blocked,
    };
    const complete = changed.length <= 512 && changed.every(([, entry]) => !!entry.snapshot);
    if (complete && setScopedDraft(shelfKey, value, lease)) {
      setOverflow(false);
      return;
    }
    // Never keep an older partial draft while implying that the newest draft fits.
    setScopedDraft(
      shelfKey,
      { ...value, forms: {}, targetFingerprint: null, overflow: true },
      lease,
    );
    setOverflow(true);
  }, [getScopeLease, kind, lease, setScopedDraft, shelfKey]);
  const register = useCallback(
    (key: string, entry: SaveEntry | null) => {
      if (entry) entries.current.set(key, entry);
      else entries.current.delete(key);
      // Unmount cleanup must not erase the retained candidate after scope revocation.
      persist();
    },
    [persist],
  );
  const registerTarget = useCallback(
    (record: unknown, blocked: boolean) => {
      target.current = { ...target.current, record, blocked };
      persist();
    },
    [persist],
  );
  const acknowledgeRecord = useCallback(
    (record: unknown) => {
      // Pin the authoritative returned ID before React paints or navigation runs.
      target.current = { ...target.current, record, pending: false };
      persist();
    },
    [persist],
  );
  const markPending = useCallback(
    (pending: boolean, uncertain = false) => {
      target.current = { ...target.current, pending, blocked: uncertain || target.current.blocked };
      persist();
    },
    [persist],
  );
  const navigate = useCallback((action: () => void) => {
    if ([...entries.current.values()].some((item) => item.dirty)) setNext(() => action);
    else action();
  }, []);
  useEffect(() => {
    if (reviewNeeded) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (allowUnload.current) {
        allowUnload.current = false;
        return;
      }
      if (
        target.current.pending ||
        target.current.blocked ||
        [...entries.current.values()].some((item) => item.dirty)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self"))
        return;
      const url = new URL(link.href, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      if (
        !target.current.pending &&
        !target.current.blocked &&
        ![...entries.current.values()].some((item) => item.dirty)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // In-flight writes cannot be turned into an ordinary leave confirmation.
      if (target.current.pending || leaveRef.current || savingRef.current) return;
      leaveRef.current = url.href;
      setLeave(url.href);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [reviewNeeded]);
  async function saveAndContinue() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveFailure(false);
    setSaving(true);
    try {
      for (const item of [...entries.current.values()])
        if (item.dirty) {
          if (!(await item.save())) {
            setSaveFailure(true);
            return;
          }
          flushSync(() => renderAcknowledgement((value) => value + 1));
        }
      const action = next;
      setNext(null);
      action?.();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function review() {
    if (reviewLock.current || !candidate || !current()) return;
    reviewLock.current = true;
    setReviewBusy(true);
    setReviewMessage("");
    try {
      let record: unknown = null;
      if (candidate.target.id) {
        const body = await request<unknown>(
          `/admin/catalog/${kind === "movie" ? "movies" : "series"}/${candidate.target.id}`,
        );
        record = catalogRecord(body, kind, candidate.target.id);
      }
      if (!current()) return;
      setReviewedRecord(record);
      if (!catalogDraftCanRestore(candidate, record)) {
        const reason = catalogRestorationConflict(candidate, record);
        const messages = {
          pending: [
            "The earlier request may have committed. Review the current record before any new action; it will not be repeated.",
            "قد يكون الطلب السابق قد حُفظ. راجع السجل الحالي قبل أي إجراء جديد؛ لن يتكرر الطلب.",
          ],
          archived: [
            "The original record is archived. Its draft has not been restored and no change was submitted.",
            "السجل الأصلي مؤرشف. لم تُستعد مسودته ولم يُرسل أي تغيير.",
          ],
          record: [
            "The original record’s metadata or status changed. The draft is kept in this session; it has not replaced current data.",
            "تغيّرت بيانات السجل الأصلي أو حالته. المسودة محفوظة في هذه الجلسة ولم تحل محل البيانات الحالية.",
          ],
          seasons: [
            "Season records or their order changed. The drafts are kept in this session and have not been restored.",
            "تغيّرت بيانات المواسم أو ترتيبها. المسودات محفوظة في هذه الجلسة ولم تُستعد.",
          ],
          episodes: [
            "Episode records or their order changed. The drafts are kept in this session and have not been restored.",
            "تغيّرت بيانات الحلقات أو ترتيبها. المسودات محفوظة في هذه الجلسة ولم تُستعد.",
          ],
          baseline: [
            "A required original baseline could not be verified. The drafts are kept in this session; no changes were submitted.",
            "تعذر التحقق من البيانات الأصلية اللازمة. المسودات محفوظة في هذه الجلسة ولم تُرسل أي تغييرات.",
          ],
        };
        setReviewMessage(messages[reason][ar ? 1 : 0]!);
        return;
      }
      const seed = { forms: candidate.forms, record, blocked: candidate.blocked };
      restoredRef.current = seed;
      setRestored(seed);
      setReviewNeeded(false);
    } catch (cause) {
      if (current())
        setReviewMessage(
          cause instanceof CatalogRequestFailure && cause.status === 404
            ? ar
              ? "لم يعد السجل الأصلي متاحًا. لم تُستعد المسودة ولم يُرسل أي تغيير."
              : "The original record is no longer available. The draft was not restored and no change was submitted."
            : ar
              ? "تعذر التحقق من السجل الأصلي. احتُفظ بالمسودة؛ حاول القراءة مجددًا."
              : "The original record could not be verified. The draft is kept; retry the read.",
        );
    } finally {
      reviewLock.current = false;
      if (current()) setReviewBusy(false);
    }
  }
  function discardRetained() {
    if (reviewBusy || !current()) return;
    setScopedDraft(shelfKey, null, lease);
    const seed = { forms: {}, record: reviewedRecord, blocked: false };
    restoredRef.current = seed;
    setRestored(seed);
    setReviewNeeded(false);
  }
  const context: CatalogDraftContext = {
    register,
    navigate,
    dirty,
    registerTarget,
    acknowledgeRecord,
    clearRestoration,
    markPending,
    restoredForm: <T,>(key: string) =>
      (restoredRef.current?.forms[key] as CatalogFormSnapshot<T> | undefined) ?? null,
    restoredRecord: <T,>() => (restoredRef.current?.record as T | null) ?? null,
    restoredBlocked: restored?.blocked ?? false,
  };
  return (
    <Drafts.Provider value={context}>
      {reviewNeeded ? (
        <section
          className={styles.recovery}
          aria-label={ar ? "استعادة مسودة المكتبة" : "Catalog draft recovery"}
        >
          <h1>{ar ? "مراجعة المسودة المحفوظة" : "Review retained draft"}</h1>
          <p>
            {candidate?.overflow
              ? ar
                ? "كانت المسودة أكبر من حد الحفظ المؤقت. يلزم بدء سجل مقروء حديثًا؛ لم تُستعد بيانات جزئية."
                : "The draft exceeded the temporary retention limit. Start from a fresh record; no partial draft was restored."
              : ar
                ? "تتطلب الاستعادة قراءة السجل الأصلي والتحقق من عدم تغيّره داخل جلسة الإدارة نفسها. لا تُرسل أي تغييرات تلقائيًا."
                : "Restoring requires a fresh read of the original record and unchanged baselines in this same administrative session. No changes are submitted automatically."}
          </p>
          {reviewMessage ? (
            <StatusNotice tone="warning" announce="polite">
              {reviewMessage}
            </StatusNotice>
          ) : null}
          <div className={styles.actions}>
            <ActionButton
              pending={reviewBusy}
              disabled={!candidate || candidate.overflow}
              onClick={() => void review()}
            >
              {ar ? "مراجعة السجل واستعادة المسودة" : "Review record and restore draft"}
            </ActionButton>
            <ActionButton tone="danger" disabled={reviewBusy} onClick={discardRetained}>
              {ar ? "تجاهل المسودة المحفوظة" : "Discard retained draft"}
            </ActionButton>
          </div>
        </section>
      ) : (
        <>
          {overflow ? (
            <StatusNotice tone="warning" announce="assertive">
              {ar
                ? "المسودات أكبر من حد الاحتفاظ. احفظها أو تجاهلها قبل المغادرة؛ لن تُحفظ جزئيًا عند العودة."
                : "These drafts exceed the retention limit. Save or discard before leaving; they cannot be partially restored on return."}
            </StatusNotice>
          ) : null}
          {children}
        </>
      )}
      {next ? (
        <NavigationDecision
          direction={direction}
          busy={saving}
          title={ar ? "تغييرات غير محفوظة" : "Unsaved changes"}
          description={
            saveFailure
              ? ar
                ? "تعذر حفظ كل المسودات. ألغِ هذه النافذة لمراجعة الحقول أو رسالة الخطأ قبل المحاولة مجددًا."
                : "Not all drafts were saved. Cancel this dialog to review the fields or error before trying again."
              : ar
                ? "احفظ المسودات المعدّلة أو تجاهلها قبل فتح سجل آخر."
                : "Save the changed drafts or discard them before opening another record."
          }
          onCancel={() => setNext(null)}
        >
          <ActionButton disabled={saving} onClick={() => setNext(null)} tone="secondary">
            {ar ? "إلغاء" : "Cancel"}
          </ActionButton>
          <ActionButton
            disabled={saving}
            tone="danger"
            onClick={() => {
              const action = next;
              setNext(null);
              action();
            }}
          >
            {ar ? "تجاهل ومتابعة" : "Discard and continue"}
          </ActionButton>
          <ActionButton pending={saving} onClick={() => void saveAndContinue()}>
            {ar ? "حفظ ومتابعة" : "Save and continue"}
          </ActionButton>
        </NavigationDecision>
      ) : null}
      <ConfirmationDialog
        open={leave !== null}
        direction={direction}
        title={ar ? "مغادرة صفحة المكتبة؟" : "Leave the catalog page?"}
        description={
          overflow
            ? ar
              ? "المسودات أكبر من حد الاحتفاظ. المغادرة تتجاهل هذه التغييرات غير المحفوظة. ألغِ المغادرة لحفظها أولًا."
              : "These drafts exceed the retention limit. Leaving discards these unsaved changes. Cancel to save them first."
            : ar
              ? "قد تُحفظ المسودة داخل جلسة الإدارة المتحقق منها فقط. تتطلب العودة قراءة السجل الأصلي دون تغيّر. مغادرة الإدارة أو إخفاء الصفحة يمسح المسودات الخاصة."
              : "The draft may be kept only in this verified Admin session. Return requires an unchanged original record read. Leaving Admin or hiding the page clears private drafts."
        }
        confirmLabel={ar ? "مغادرة الصفحة" : "Leave page"}
        cancelLabel={ar ? "متابعة التحرير" : "Keep editing"}
        onCancel={() => {
          leaveRef.current = null;
          setLeave(null);
        }}
        onConfirm={() => {
          const destination = leaveRef.current;
          if (!destination || !current()) return;
          leaveRef.current = null;
          setLeave(null);
          if (overflow) setScopedDraft(shelfKey, null, lease);
          const url = new URL(destination);
          if (url.origin === location.origin) router.push(url.pathname + url.search + url.hash);
          else {
            allowUnload.current = true;
            location.assign(destination);
          }
        }}
      />
    </Drafts.Provider>
  );
}

function NavigationDecision({
  title,
  description,
  direction,
  busy,
  onCancel,
  children,
}: {
  title: string;
  description: string;
  direction: "rtl" | "ltr";
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      dir={direction}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      onKeyDown={trapDialogTab}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className={styles.actions}>{children}</div>
    </dialog>
  );
}

export function useCatalogDrafts() {
  const context = useContext(Drafts);
  if (!context) throw new Error("Catalog draft workspace required");
  return context;
}

export function useCatalogDirty(
  key: string,
  dirty: boolean,
  save: () => Promise<boolean>,
  snapshot?: CatalogFormSnapshot,
) {
  const { register } = useCatalogDrafts();
  const latest = useRef(save);
  useLayoutEffect(() => {
    latest.current = save;
  });
  useLayoutEffect(() => {
    register(key, { dirty, save: () => latest.current(), ...(snapshot ? { snapshot } : {}) });
  }, [key, dirty, register, snapshot]);
  useLayoutEffect(() => () => register(key, null), [key, register]);
}

export function useCatalogTarget(record: unknown, blocked: boolean) {
  const { registerTarget } = useCatalogDrafts();
  useLayoutEffect(() => {
    registerTarget(record, blocked);
  }, [record, blocked, registerTarget]);
}

export function useCatalogRequest() {
  const lease = useContext(Scope);
  const { getScopeLease, invalidateScope } = useAdminAccess();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = useCallback(
    () => active.current && !!lease && getScopeLease() === lease,
    [getScopeLease, lease],
  );
  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      if (!current() || !lease)
        throw new Error("Administrative identity changed. Reopen the catalog.");
      const headers = new Headers(init.headers);
      headers.set("x-ayin-expected-account", lease.session.accountId);
      headers.set("x-ayin-expected-session", lease.session.sessionId);
      if (init.body) headers.set("content-type", "application/json");
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "include",
      });
      if (!current()) throw new Error("Administrative identity changed. Reopen the catalog.");
      if (!response.ok) {
        const failure: unknown = await response
          .clone()
          .json()
          .catch(() => null);
        if (catalogIdentityFailure(response.status, failure)) invalidateScope();
        throw new CatalogRequestFailure(await readAdminApiError(response), response.status);
      }
      const body: unknown = await response.json();
      if (!current()) throw new Error("Administrative identity changed. Reopen the catalog.");
      return body as T;
    },
    [current, invalidateScope, lease],
  );
  return { request, current };
}

export function draftChanged(a: unknown, b: unknown) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Only changed form fields enter PATCH; omitted hidden metadata stays authoritative. */
export function changedCatalogFields<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(after).filter(([key, value]) => draftChanged(value, before[key as keyof T])),
  ) as Partial<T>;
}

export class CatalogRequestFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function catalogOutcomeUncertain(cause: unknown) {
  return !(cause instanceof CatalogRequestFailure && cause.status >= 400 && cause.status < 500);
}

export function concealCatalogDom(root: HTMLElement) {
  root.hidden = true;
  root.inert = true;
  for (const dialog of root.querySelectorAll("dialog")) {
    dialog.hidden = true;
    dialog.close();
  }
  for (const field of root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input,textarea,select")) {
    if (field instanceof HTMLSelectElement) {
      for (const option of field.options) {
        option.selected = false;
        option.defaultSelected = false;
      }
      field.selectedIndex = -1;
    } else {
      field.value = "";
      field.defaultValue = "";
      field.removeAttribute("value");
    }
  }
}
