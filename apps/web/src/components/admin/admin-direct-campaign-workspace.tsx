"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  DataBadge,
  PageHeader,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { AdPlacement, Campaign } from "@/lib/admin-advertising";
import { useAdminAccess } from "./admin-access";
import {
  sameAdminSessionScope,
  type DirectAdminSession,
  type AdminScopeLease,
} from "@/lib/admin-session-scope";
import {
  AdminWorkspaceError,
  DirectWriteError,
  DirectReadError,
  readDirectWorkspace,
  reviewDirectCommand,
  saveDirectCommand,
  searchDirectTargets,
  type DirectCommand,
  type DirectKind,
  type DirectRecord,
  type DirectWorkspace,
  type DirectAcknowledgment,
} from "@/lib/admin-direct-campaign-workspace";
import {
  editorCommand,
  editorDraft,
  editorDirty,
  draftSignature,
  reconcileDirectEditor,
  type DirectEditor,
} from "@/lib/admin-direct-campaign-drafts";
import { AdvertiserFields, DirectCampaignFields } from "./admin-direct-campaign-fields";
import styles from "./admin-record-workspace.module.css";
import directStyles from "./admin-direct-campaign-workspace.module.css";

type Editors = Record<DirectKind, DirectEditor | null>;
type Retained = {
  actor: DirectAdminSession;
  editors: Editors;
  pending: DirectCommand | null;
  acknowledgment: DirectAcknowledgment | null;
};
const draftShelfKey = "direct-campaign";
type Intent =
  | { kind: "close"; panel: DirectKind }
  | { kind: "select"; panel: DirectKind; record?: DirectRecord }
  | { kind: "delete"; panel: DirectKind }
  | { kind: "activate"; panel: DirectKind }
  | { kind: "navigate"; href: string }
  | { kind: "adopt"; panel: DirectKind };
type Failure = "read" | "denied" | "invalid" | "verification" | "uncertain" | "conflict" | null;
type State = {
  snapshot: DirectWorkspace | null;
  editors: Editors;
  visible: boolean;
  busy: "read" | "write" | "review" | null;
  failure: Failure;
  pending: DirectCommand | null;
  acknowledgment: DirectAcknowledgment | null;
  reviewed: boolean;
  generation: number;
  destruction: number;
  retentionFailure: boolean;
  retentionLost: boolean;
};
type Workspace = State & {
  placements: AdPlacement[];
  edit: (editor: DirectEditor) => void;
  choose: (kind: DirectKind, record?: DirectRecord) => void;
  close: (kind: DirectKind) => void;
  save: (kind: DirectKind) => void;
  remove: (kind: DirectKind) => void;
  load: () => void;
  recover: () => void;
  adopt: (kind: DirectKind) => void;
  targetSearch: (query: string) => ReturnType<typeof searchDirectTargets>;
};
const Context = createContext<Workspace | null>(null);
export function DirectCampaignWorkspaceProvider({
  children,
  active,
  readRevision,
  placements,
  onCampaignsChange,
}: {
  children: ReactNode;
  active: boolean;
  readRevision: number;
  placements: AdPlacement[];
  onCampaignsChange: (campaigns: Campaign[]) => void;
}) {
  const { locale, direction } = useI18n(),
    ar = locale === "ar";
  const copy = (en: string, arabic: string) => (ar ? arabic : en);
  const router = useRouter();
  const access = useAdminAccess();
  const {
    getScopeLease,
    getScopedDraft,
    getScopedDraftFailure,
    setScopedDraft,
    subscribeScopeInvalidation,
    invalidateScope,
    refresh: refreshAccess,
  } = access;
  const lease = useRef<AdminScopeLease | null>(null);
  const [state, setState] = useState<State>({
    snapshot: null,
    editors: { advertiser: null, campaign: null },
    visible: false,
    busy: null,
    failure: null,
    pending: null,
    acknowledgment: null,
    reviewed: false,
    generation: 0,
    destruction: 0,
    retentionFailure: false,
    retentionLost: false,
  });
  const stateRef = useRef(state),
    actor = useRef<DirectAdminSession | null>(null),
    controller = useRef<AbortController | null>(null),
    searchControllers = useRef(new Set<AbortController>()),
    operation = useRef(false),
    mounted = useRef(true),
    root = useRef<HTMLDivElement>(null),
    epoch = useRef(0),
    initial = useRef(true),
    lastRevision = useRef(readRevision),
    explicitRead = useRef(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const intentRef = useRef<Intent | null>(null);
  const update = useCallback(
    (patch: Partial<State>) => {
      const next = { ...stateRef.current, ...patch };
      if (actor.current && lease.current && !next.retentionLost) {
        const retained = setScopedDraft(
          draftShelfKey,
          {
            actor: actor.current,
            editors: next.editors,
            pending: next.pending,
            acknowledgment: next.acknowledgment,
          },
          lease.current,
        );
        // A scope review also refuses stale writes; it is not a capacity failure.
        if (getScopeLease() === lease.current) next.retentionFailure = !retained;
      }
      stateRef.current = next;
      if (mounted.current) {
        setState(next);
        if (patch.snapshot) onCampaignsChange(patch.snapshot.campaigns);
      }
    },
    [setScopedDraft, getScopeLease, onCampaignsChange],
  );
  const conceal = useCallback(
    (denied = false) => {
      epoch.current++;
      controller.current?.abort();
      controller.current = null;
      for (const pending of searchControllers.current) pending.abort();
      searchControllers.current.clear();
      operation.current = false;
      for (const node of root.current?.querySelectorAll<HTMLElement>("[data-direct-private]") ??
        []) {
        node.hidden = true;
        node.querySelectorAll("dialog").forEach((dialog) => {
          dialog.hidden = true;
          dialog.close();
        });
        node
          .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
            "input,textarea,select",
          )
          .forEach((field) => {
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
              if (field instanceof HTMLInputElement) {
                field.checked = false;
                field.defaultChecked = false;
                field.removeAttribute("checked");
              }
            }
          });
      }
      intentRef.current = null;
      setIntent(null);
      if (denied) {
        actor.current = null;
        if (lease.current) setScopedDraft(draftShelfKey, null, lease.current);
        lease.current = null;
      }
      update({
        visible: false,
        snapshot: null,
        busy: null,
        failure: denied ? "denied" : "read",
        reviewed: false,
        ...(denied
          ? {
              editors: { advertiser: null, campaign: null },
              pending: null,
              acknowledgment: null,
              destruction: stateRef.current.destruction + 1,
              retentionFailure: false,
              retentionLost: false,
            }
          : {}),
      });
    },
    [update, setScopedDraft],
  );
  const load = useCallback(async () => {
    if (operation.current) return;
    const currentLease = getScopeLease();
    if (!currentLease) {
      explicitRead.current = true;
      refreshAccess();
      update({ failure: "read", visible: false });
      return;
    }
    if (actor.current && !sameAdminSessionScope(actor.current, currentLease.session)) {
      conceal(true);
      return;
    }
    lease.current = currentLease;
    operation.current = true;
    const pending = new AbortController(),
      generation = epoch.current;
    controller.current = pending;
    update({ busy: "read", failure: null });
    const prior = actor.current ? null : getScopedDraft<Retained>(draftShelfKey, currentLease);
    const retentionLost =
      stateRef.current.retentionLost ||
      (!actor.current && getScopedDraftFailure(draftShelfKey, currentLease));
    try {
      const snapshot = await readDirectWorkspace(
        pending.signal,
        actor.current ?? prior?.actor ?? currentLease.session,
      );
      if (!mounted.current || pending.signal.aborted || epoch.current !== generation) return;
      actor.current = snapshot.actor;
      const editors = prior?.editors ?? stateRef.current.editors;
      const unknown = prior?.pending ?? stateRef.current.pending;
      update({
        snapshot,
        visible: true,
        generation: stateRef.current.generation + 1,
        editors: {
          advertiser: reconcileDirectEditor(
            editors.advertiser,
            snapshot.advertisers,
            snapshot.campaigns,
            unknown?.kind === "advertiser",
          ),
          campaign: reconcileDirectEditor(
            editors.campaign,
            snapshot.advertisers,
            snapshot.campaigns,
            unknown?.kind === "campaign",
          ),
        },
        pending: unknown,
        acknowledgment: prior?.acknowledgment ?? stateRef.current.acknowledgment,
        failure: unknown ? "uncertain" : null,
        retentionLost,
        retentionFailure: retentionLost || stateRef.current.retentionFailure,
      });
    } catch (error) {
      if (pending.signal.aborted || epoch.current !== generation) return;
      if (
        error instanceof DirectReadError &&
        !error.identityUnverified &&
        ![401, 403, 409].includes(error.status)
      ) {
        update({ snapshot: null, failure: "read" });
      } else {
        invalidateScope();
        conceal(true);
        update({
          failure:
            error instanceof AdminWorkspaceError && [401, 403, 409].includes(error.status)
              ? "denied"
              : "read",
        });
      }
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        update({ busy: null });
      }
    }
  }, [
    conceal,
    update,
    getScopeLease,
    getScopedDraft,
    getScopedDraftFailure,
    invalidateScope,
    refreshAccess,
  ]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeScopeInvalidation((reason) => conceal(reason === "invalidated"));
    return () => {
      unsubscribe();
      mounted.current = false;
      conceal();
    };
  }, [conceal, subscribeScopeInvalidation]);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (!current) return;
      if (explicitRead.current && getScopeLease()) {
        explicitRead.current = false;
        void load();
      } else if (active && initial.current && getScopeLease()) {
        initial.current = false;
        const existing = getScopedDraft<Retained>(draftShelfKey, getScopeLease()!);
        const retentionLost = getScopedDraftFailure(draftShelfKey, getScopeLease()!);
        if (existing || retentionLost)
          update({ failure: "read", retentionLost, retentionFailure: retentionLost });
        else void load();
      } else if (readRevision !== lastRevision.current) {
        lastRevision.current = readRevision;
        if (actor.current && stateRef.current.visible) void load();
      }
    });
    return () => {
      current = false;
    };
  }, [
    active,
    readRevision,
    load,
    access.loading,
    access.session,
    getScopeLease,
    getScopedDraft,
    getScopedDraftFailure,
    update,
  ]);
  function ask(next: Intent) {
    if (operation.current || intentRef.current || !stateRef.current.visible) return;
    intentRef.current = next;
    setIntent(next);
  }
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (
        operation.current ||
        stateRef.current.pending ||
        Object.values(stateRef.current.editors).some(editorDirty)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download"))
        return;
      const next = new URL(link.href);
      if (
        next.origin !== location.origin ||
        (next.pathname === location.pathname && next.search === location.search)
      )
        return;
      if (
        !operation.current &&
        !stateRef.current.pending &&
        !Object.values(stateRef.current.editors).some(editorDirty)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (operation.current || intentRef.current) return;
      intentRef.current = { kind: "navigate", href: next.pathname + next.search + next.hash };
      setIntent(intentRef.current);
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
    };
  }, []);
  function edit(editor: DirectEditor) {
    update({
      editors: { ...stateRef.current.editors, [editor.kind]: editor },
      retentionLost: false,
    });
  }
  function choose(panel: DirectKind, record?: DirectRecord) {
    if (operation.current || stateRef.current.pending) return;
    if (editorDirty(stateRef.current.editors[panel])) {
      ask({ kind: "select", panel, ...(record ? { record } : {}) });
      return;
    }
    edit(editorDraft(panel, record));
    update({ acknowledgment: null, failure: null });
  }
  function close(panel: DirectKind) {
    if (operation.current || stateRef.current.pending) return;
    if (editorDirty(stateRef.current.editors[panel])) {
      ask({ kind: "close", panel });
      return;
    }
    update({ editors: { ...stateRef.current.editors, [panel]: null }, failure: null });
  }
  async function submit(panel: DirectKind, action: "create" | "update" | "delete") {
    const current = stateRef.current,
      editor = current.editors[panel];
    if (!lease.current || getScopeLease() !== lease.current) {
      conceal();
      return;
    }
    if (
      !editor ||
      !actor.current ||
      !current.snapshot ||
      !current.visible ||
      current.pending ||
      operation.current
    )
      return;
    const latest = editor.original
      ? (panel === "advertiser" ? current.snapshot.advertisers : current.snapshot.campaigns).find(
          (r) => r.id === editor.original?.id,
        )
      : null;
    if (editor.original && latest?.updatedAt !== editor.original.updatedAt) {
      update({ failure: "conflict" });
      return;
    }
    let command: DirectCommand;
    try {
      command = editorCommand(editor, crypto.randomUUID(), current.snapshot.advertisers, action);
    } catch {
      update({ failure: "invalid" });
      return;
    }
    operation.current = true;
    const pending = new AbortController(),
      generation = epoch.current,
      captured = draftSignature(editor);
    controller.current = pending;
    update({
      busy: "write",
      pending: command,
      failure: null,
      acknowledgment: null,
      reviewed: false,
    });
    try {
      const outcome = await saveDirectCommand(actor.current, command, pending.signal);
      if (!mounted.current || pending.signal.aborted || epoch.current !== generation) return;
      const now = stateRef.current,
        sameDraft = now.editors[panel] && draftSignature(now.editors[panel]!) === captured;
      const nextEditor = outcome.record
        ? sameDraft
          ? editorDraft(panel, outcome.record)
          : ({ ...now.editors[panel]!, original: outcome.record } as DirectEditor)
        : null;
      const snapshot = now.snapshot!;
      const advertisers =
        panel === "advertiser"
          ? snapshot.advertisers.filter((r) => r.id !== outcome.acknowledgment.entityId)
          : snapshot.advertisers;
      const campaigns =
        panel === "campaign"
          ? snapshot.campaigns.filter((r) => r.id !== outcome.acknowledgment.entityId)
          : snapshot.campaigns;
      if (outcome.record) {
        if (panel === "advertiser")
          advertisers.push(outcome.record as DirectWorkspace["advertisers"][number]);
        else campaigns.push(outcome.record as DirectWorkspace["campaigns"][number]);
      }
      update({
        snapshot: {
          ...snapshot,
          advertisers,
          campaigns:
            panel === "advertiser" && outcome.record
              ? campaigns.map((r) =>
                  r.advertiserId === outcome.record!.id
                    ? { ...r, advertiser: { name: outcome.record!.name } }
                    : r,
                )
              : campaigns,
        },
        editors: { ...now.editors, [panel]: nextEditor },
        pending: null,
        acknowledgment: outcome.acknowledgment,
      });
    } catch (error) {
      if (pending.signal.aborted || epoch.current !== generation) return;
      if (error instanceof DirectWriteError && error.acknowledged) {
        update({ pending: null, acknowledgment: error.acknowledged.acknowledgment });
        invalidateScope();
        conceal(true);
        // The bare committed outcome may be shown without private record facts.
        update({ acknowledgment: error.acknowledged.acknowledgment });
      } else if (error instanceof DirectWriteError && !error.writeStarted) {
        invalidateScope();
        conceal(true);
        update({ failure: "read" });
      } else if (error instanceof AdminWorkspaceError && error.verificationRequired)
        update({ failure: "verification", pending: null });
      else if (
        error instanceof AdminWorkspaceError &&
        ([401, 403].includes(error.status) ||
          ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(error.code))
      ) {
        invalidateScope();
        conceal(true);
      } else if (error instanceof AdminWorkspaceError && error.status === 409) {
        update({ pending: null, failure: "conflict" });
        conceal();
      } else if (error instanceof AdminWorkspaceError && [400, 404].includes(error.status))
        update({ pending: null, failure: "invalid" });
      else update({ failure: "uncertain" });
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        update({ busy: null });
      }
    }
  }
  async function recover() {
    const current = stateRef.current,
      command = current.pending;
    if (!lease.current || getScopeLease() !== lease.current) {
      conceal();
      return;
    }
    if (!command || !actor.current || operation.current || !current.visible) return;
    const pending = new AbortController(),
      generation = epoch.current;
    controller.current = pending;
    operation.current = true;
    update({ busy: "review", reviewed: false });
    let confirmed: DirectAcknowledgment | null = null;
    try {
      const ack = await reviewDirectCommand(actor.current, command, pending.signal);
      if (pending.signal.aborted || epoch.current !== generation) return;
      if (!ack) {
        update({ failure: "uncertain", reviewed: true });
        return;
      }
      confirmed = ack;
      update({ acknowledgment: ack });
      const snapshot = await readDirectWorkspace(pending.signal, actor.current);
      if (pending.signal.aborted || epoch.current !== generation) return;
      const record = (
        command.kind === "advertiser" ? snapshot.advertisers : snapshot.campaigns
      ).find((r) => r.id === ack.entityId);
      const editor = stateRef.current.editors[command.kind];
      update({
        snapshot,
        pending: null,
        acknowledgment: ack,
        failure: null,
        reviewed: true,
        editors: {
          ...stateRef.current.editors,
          [command.kind]:
            command.action === "delete" || !record
              ? null
              : editor
                ? ({ ...editor, original: { ...record, updatedAt: ack.updatedAt } } as DirectEditor)
                : editorDraft(command.kind, { ...record, updatedAt: ack.updatedAt }),
        },
      });
    } catch (error) {
      if (pending.signal.aborted || epoch.current !== generation) return;
      if (confirmed || (error instanceof DirectReadError && error.acknowledgment)) {
        const acknowledgment = confirmed ?? (error as DirectReadError).acknowledgment;
        if (error instanceof DirectReadError && !error.identityUnverified) {
          update({ acknowledgment, snapshot: null, failure: "read" });
        } else {
          invalidateScope();
          conceal(true);
          update({ acknowledgment, pending: null, failure: "read" });
        }
      } else if (error instanceof DirectReadError && error.identityUnverified) {
        invalidateScope();
        conceal(true);
      } else update({ failure: "read" });
    } finally {
      if (controller.current === pending) {
        controller.current = null;
        operation.current = false;
        update({ busy: null });
      }
    }
  }
  async function targetSearch(query: string) {
    if (
      !actor.current ||
      !stateRef.current.visible ||
      !lease.current ||
      getScopeLease() !== lease.current
    )
      throw new AdminWorkspaceError(403);
    const pending = new AbortController(),
      generation = epoch.current;
    searchControllers.current.add(pending);
    try {
      const result = await searchDirectTargets(actor.current, query, pending.signal);
      if (pending.signal.aborted || generation !== epoch.current) throw new AdminWorkspaceError();
      return result;
    } catch (error) {
      if (!pending.signal.aborted && error instanceof DirectReadError && error.identityUnverified) {
        invalidateScope();
        conceal(true);
      }
      throw error;
    } finally {
      searchControllers.current.delete(pending);
    }
  }
  function confirm() {
    const next = intentRef.current;
    if (!next || operation.current || !stateRef.current.visible) return;
    intentRef.current = null;
    setIntent(null);
    if (next.kind === "navigate") {
      router.push(next.href);
      return;
    }
    if (next.kind === "delete") {
      void submit(next.panel, "delete");
      return;
    }
    if (next.kind === "activate") {
      void submit(next.panel, stateRef.current.editors[next.panel]?.original ? "update" : "create");
      return;
    }
    if (next.kind === "close") {
      update({ editors: { ...stateRef.current.editors, [next.panel]: null } });
      return;
    }
    if (next.kind === "select") {
      edit(editorDraft(next.panel, next.record));
      return;
    }
    const current = stateRef.current,
      editor = current.editors[next.panel];
    const record = (
      next.panel === "advertiser" ? current.snapshot?.advertisers : current.snapshot?.campaigns
    )?.find((r) => r.id === editor?.original?.id);
    if (editor && record) {
      edit({ ...editor, original: record } as DirectEditor);
      update({ failure: null });
    }
  }
  const value: Workspace = {
    ...state,
    placements,
    edit,
    choose,
    close,
    save: (kind) => {
      const editor = stateRef.current.editors[kind];
      if (
        kind === "campaign" &&
        editor?.draft.status === "ACTIVE" &&
        editor.original?.status !== "ACTIVE"
      )
        ask({ kind: "activate", panel: kind });
      else void submit(kind, editor?.original ? "update" : "create");
    },
    remove: (panel) => ask({ kind: "delete", panel }),
    load: () => void load(),
    recover: () => void recover(),
    adopt: (panel) => ask({ kind: "adopt", panel }),
    targetSearch,
  };
  return (
    <Context.Provider value={value}>
      <div ref={root}>
        {children}
        <div data-direct-private hidden={!state.visible}>
          <ConfirmationDialog
            open={intent !== null && state.visible}
            direction={direction}
            title={
              intent?.kind === "activate"
                ? copy("Activate this campaign?", "تفعيل هذه الحملة؟")
                : intent?.kind === "delete"
                  ? copy("Delete this record?", "حذف هذا السجل؟")
                  : intent?.kind === "adopt"
                    ? copy("Use the current version?", "استخدام الإصدار الحالي؟")
                    : copy("Leave this draft?", "مغادرة هذه المسودة؟")
            }
            description={
              intent?.kind === "activate"
                ? copy(
                    "An active campaign may become eligible for delivery under the existing advertising rules. Review its schedule, targeting and limits before saving.",
                    "قد تصبح الحملة النشطة مؤهلة للعرض وفق قواعد الإعلانات الحالية. راجع جدولتها واستهدافها وحدودها قبل الحفظ.",
                  )
                : intent?.kind === "delete"
                  ? copy(
                      "Only advertisers without campaigns and draft campaigns without delivery events can be deleted. Deleting a campaign also removes its creatives. This action is audited.",
                      "يمكن حذف المعلنين بلا حملات والحملات المسودة بلا أحداث عرض فقط. يؤدي حذف الحملة أيضًا إلى حذف موادها الإعلانية. يُسجّل هذا الإجراء للمراجعة.",
                    )
                  : intent?.kind === "adopt"
                    ? copy(
                        "Keep your draft and use the current record as its new baseline. Review all values before explicitly saving again.",
                        "احتفظ بمسودتك واستخدم السجل الحالي أساسًا جديدًا لها. راجع كل القيم قبل الحفظ مجددًا بنفسك.",
                      )
                    : intent?.kind === "navigate" && state.retentionFailure
                      ? copy(
                          "This draft cannot be kept across navigation. Leaving discards its unsaved edits; keep editing to shorten or save them first.",
                          "لا يمكن الاحتفاظ بهذه المسودة عند التنقل. المغادرة تتجاهل التعديلات غير المحفوظة؛ تابع التحرير لتقليلها أو حفظها أولًا.",
                        )
                      : intent?.kind === "navigate"
                        ? copy(
                            "Your draft may be kept only within this verified admin session. Leaving Admin or an unverified session clears private drafts. Returning requires an explicit read; nothing is submitted automatically.",
                            "قد تُحفظ المسودة داخل جلسة الإدارة المتحقق منها فقط. تُمسح المسودات الخاصة عند مغادرة الإدارة أو تعذّر التحقق من الجلسة. تتطلب العودة قراءة صريحة؛ لا يُرسل شيء تلقائيًا.",
                          )
                        : copy(
                            "Discard this editor's unsaved changes?",
                            "تجاهل التغييرات غير المحفوظة في هذا المحرّر؟",
                          )
            }
            confirmLabel={
              intent?.kind === "activate"
                ? copy("Save active campaign", "حفظ الحملة النشطة")
                : intent?.kind === "delete"
                  ? copy("Delete", "حذف")
                  : intent?.kind === "adopt"
                    ? copy("Keep draft with current version", "الاحتفاظ بالمسودة مع الإصدار الحالي")
                    : intent?.kind === "navigate"
                      ? copy("Leave page", "مغادرة الصفحة")
                      : copy("Discard draft", "تجاهل المسودة")
            }
            cancelLabel={copy("Keep editing", "متابعة التحرير")}
            onCancel={() => {
              intentRef.current = null;
              setIntent(null);
            }}
            onConfirm={confirm}
          />
        </div>
      </div>
    </Context.Provider>
  );
}

export function DirectCampaignPanel({ kind }: { kind: DirectKind }) {
  const context = useContext(Context);
  if (!context) throw Error("Direct campaign workspace required");
  return <DirectCampaignPanelBody key={context.destruction} kind={kind} />;
}
function DirectCampaignPanelBody({ kind }: { kind: DirectKind }) {
  const context = useContext(Context);
  if (!context) throw Error("Direct campaign workspace required");
  const c = context,
    { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = c.editors[kind];
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [editor?.original?.id, editor?.kind]);
  const rows = (kind === "advertiser" ? c.snapshot?.advertisers : c.snapshot?.campaigns) ?? [];
  const filtered = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      [r.name, r.id, "advertiser" in r ? r.advertiser.name : ""].some((v) =>
        v.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
      ),
  );
  const shownPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 25)));
  const current = editor?.original ? rows.find((r) => r.id === editor.original?.id) : undefined;
  const conflict =
    !!editor?.original && !!c.snapshot && current?.updatedAt !== editor.original.updatedAt;
  const blocked = !c.visible || !c.snapshot || c.busy !== null || c.pending !== null;
  const statusLabel = (value: string) =>
    ({
      ACTIVE: copy("Active", "نشط"),
      PAUSED: copy("Paused", "متوقف مؤقتًا"),
      DISABLED: copy("Disabled", "معطّل"),
      DRAFT: copy("Draft", "مسودة"),
      COMPLETED: copy("Completed", "مكتمل"),
      CANCELLED: copy("Cancelled", "ملغى"),
    })[value] ?? value;
  return (
    <section
      className={styles.workspace}
      aria-label={
        kind === "advertiser"
          ? copy("Advertiser workspace", "مساحة عمل المعلنين")
          : copy("Campaign workspace", "مساحة عمل الحملات")
      }
    >
      <PageHeader
        level={2}
        title={
          kind === "advertiser"
            ? copy("Advertisers", "المعلنون")
            : copy("Direct campaigns", "الحملات المباشرة")
        }
        description={
          kind === "advertiser"
            ? copy(
                "Find an advertiser or create a new record. Changes are audited.",
                "ابحث عن معلن أو أنشئ سجلًا جديدًا. تُسجّل التغييرات للمراجعة.",
              )
            : copy(
                "Create a draft with a name and advertiser. Delivery, schedule and targeting are optional settings.",
                "أنشئ مسودة باسم ومعلن. إعدادات العرض والجدولة والاستهداف اختيارية.",
              )
        }
        actions={
          <ActionButton tone="secondary" disabled={c.busy !== null} onClick={c.load}>
            {copy("Read current records", "قراءة السجلات الحالية")}
          </ActionButton>
        }
      />
      {c.busy ? (
        <StatusNotice announce="polite">
          {c.busy === "write"
            ? copy("Saving this action…", "جارٍ حفظ الإجراء…")
            : copy("Reading current records…", "جارٍ قراءة السجلات الحالية…")}
        </StatusNotice>
      ) : null}
      {c.retentionFailure || c.retentionLost ? (
        <StatusNotice tone="warning" announce="assertive">
          {c.retentionLost
            ? copy(
                "The earlier draft could not be retained. No older draft was restored. Start from the current records.",
                "تعذر الاحتفاظ بالمسودة السابقة. لم تُستعد أي مسودة أقدم. ابدأ من السجلات الحالية.",
              )
            : copy(
                "This draft cannot be kept across navigation. Keep this page open and shorten or save the edits before leaving.",
                "لا يمكن الاحتفاظ بهذه المسودة عند التنقل. أبقِ الصفحة مفتوحة وقلّل التعديلات أو احفظها قبل المغادرة.",
              )}
        </StatusNotice>
      ) : null}
      {c.acknowledgment ? (
        <StatusNotice tone="success" announce="polite">
          {copy(
            "The action was committed and recorded in the audit log. No action was repeated.",
            "تم حفظ الإجراء وتسجيله للمراجعة. لم يُكرّر أي إجراء.",
          )}
        </StatusNotice>
      ) : null}
      {c.failure ? (
        <StatusNotice tone={c.failure === "verification" ? "warning" : "danger"} announce="polite">
          {c.failure === "denied"
            ? copy(
                "Access changed. Private records and drafts were cleared. Verify the current account before reading again.",
                "تغيّر الوصول. أُزيلت السجلات والمسودات الخاصة. تحقّق من الحساب الحالي قبل القراءة مجددًا.",
              )
            : c.failure === "verification"
              ? copy(
                  "Verify your session, then review and submit the same action yourself. Your draft is retained.",
                  "تحقّق من الجلسة، ثم راجع الإجراء وأرسله بنفسك. احتُفظ بالمسودة.",
                )
              : c.failure === "uncertain"
                ? copy(
                    "The action's outcome is not confirmed. Your draft is retained and writes are locked. Read the original action's audit record before continuing.",
                    "نتيجة الإجراء غير مؤكدة. احتُفظ بالمسودة وأُقفلت التعديلات. اقرأ سجل مراجعة الإجراء الأصلي قبل المتابعة.",
                  )
                : c.failure === "invalid"
                  ? copy(
                      "The action was not accepted. Check the values and current record; your draft is retained.",
                      "لم يُقبل الإجراء. راجع القيم والسجل الحالي؛ احتُفظ بالمسودة.",
                    )
                  : c.failure === "conflict"
                    ? copy(
                        "The record changed. Read and review its current values before saving your retained draft.",
                        "تغيّر السجل. اقرأ قيمه الحالية وراجعها قبل حفظ المسودة المحتفظ بها.",
                      )
                    : copy(
                        "Current records could not be verified. Read again to continue; no action is repeated.",
                        "تعذّر التحقق من السجلات الحالية. اقرأ مجددًا للمتابعة؛ لا يُكرّر أي إجراء.",
                      )}
        </StatusNotice>
      ) : null}
      {!c.visible ? (
        <StatusNotice>
          {copy(
            "Records are concealed until you explicitly read and verify this workspace.",
            "السجلات مخفية إلى أن تقرأ مساحة العمل وتتحقّق منها بنفسك.",
          )}
        </StatusNotice>
      ) : null}
      <div
        key={c.generation}
        data-direct-private
        hidden={!c.visible}
        className={directStyles.privateBody}
      >
        {c.pending ? (
          <div className={styles.actions}>
            <ActionButton disabled={c.busy !== null} onClick={c.recover}>
              {copy("Review original action", "مراجعة الإجراء الأصلي")}
            </ActionButton>
            {c.reviewed ? (
              <StatusNotice>
                {copy(
                  "No committed audit record was found yet. This does not prove the action failed. Writes remain locked; review again later.",
                  "لم يُعثر على سجل مراجعة محفوظ بعد. هذا لا يثبت فشل الإجراء. تبقى التعديلات مقفلة؛ راجع مجددًا لاحقًا.",
                )}
              </StatusNotice>
            ) : null}
          </div>
        ) : null}
        {editor ? (
          <article className={styles.record}>
            <h3 ref={heading} tabIndex={-1}>
              {editor.original ? (
                <bdi>{editor.original.name}</bdi>
              ) : kind === "advertiser" ? (
                copy("New advertiser", "معلن جديد")
              ) : (
                copy("New campaign draft", "مسودة حملة جديدة")
              )}
            </h3>
            {editor.original ? (
              <p className={directStyles.identifier}>
                <bdi>{editor.original.id}</bdi>
              </p>
            ) : null}
            {editorDirty(editor) ? (
              <DataBadge tone="warning">{copy("Unsaved draft", "مسودة غير محفوظة")}</DataBadge>
            ) : null}
            {conflict ? (
              <StatusNotice tone="warning">
                {current
                  ? copy(
                      "A newer version is available. Your draft still uses the original version.",
                      "يتوفر إصدار أحدث. لا تزال مسودتك تستخدم الإصدار الأصلي.",
                    )
                  : copy(
                      "The original record is no longer available. Your draft cannot be saved to a different record.",
                      "لم يعد السجل الأصلي متاحًا. لا يمكن حفظ المسودة في سجل آخر.",
                    )}
              </StatusNotice>
            ) : null}
            {conflict && current ? (
              <Disclosure
                summary={copy("Review current saved values", "مراجعة القيم المحفوظة الحالية")}
              >
                <RecordFields editor={editorDraft(kind, current)} c={c} disabled />
                <ActionButton disabled={blocked} onClick={() => c.adopt(kind)}>
                  {copy("Keep draft with current version", "الاحتفاظ بالمسودة مع الإصدار الحالي")}
                </ActionButton>
              </Disclosure>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                c.save(kind);
              }}
            >
              <RecordFields
                editor={editor}
                c={c}
                disabled={
                  !c.snapshot || c.pending !== null || c.busy === "write" || c.busy === "review"
                }
              />
              <div className={styles.actions}>
                <ActionButton type="submit" disabled={blocked || conflict || !editorDirty(editor)}>
                  {editor.original
                    ? copy("Save changes", "حفظ التغييرات")
                    : kind === "advertiser"
                      ? copy("Create advertiser", "إنشاء معلن")
                      : editor.draft.status === "DRAFT"
                        ? copy("Create campaign draft", "إنشاء مسودة حملة")
                        : copy("Create campaign", "إنشاء حملة")}
                </ActionButton>
                <ActionButton
                  tone="secondary"
                  disabled={c.busy !== null || c.pending !== null}
                  onClick={() => c.close(kind)}
                >
                  {copy("Close editor", "إغلاق المحرّر")}
                </ActionButton>
                {editor.original &&
                (kind === "advertiser" || editor.original.status === "DRAFT") ? (
                  <ActionButton
                    tone="danger"
                    disabled={blocked || conflict || editorDirty(editor)}
                    onClick={() => c.remove(kind)}
                  >
                    {kind === "advertiser"
                      ? copy("Delete advertiser", "حذف المعلن")
                      : copy("Delete draft", "حذف المسودة")}
                  </ActionButton>
                ) : null}
              </div>
            </form>
          </article>
        ) : (
          <ActionButton disabled={blocked} onClick={() => c.choose(kind)}>
            {kind === "advertiser"
              ? copy("New advertiser", "معلن جديد")
              : copy("New campaign", "حملة جديدة")}
          </ActionButton>
        )}
        <div className={styles.filters}>
          <TextField
            id={`direct-${kind}-search`}
            label={
              kind === "advertiser"
                ? copy("Search advertisers", "البحث عن معلنين")
                : copy("Search campaigns or advertisers", "البحث عن حملات أو معلنين")
            }
            value={query}
            maxLength={200}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <SelectField
            id={`direct-${kind}-filter`}
            label={copy("Status filter", "تصفية الحالة")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{copy("All statuses", "كل الحالات")}</option>
            {(kind === "advertiser"
              ? ["ACTIVE", "PAUSED", "DISABLED"]
              : ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]
            ).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </SelectField>
        </div>
        {c.snapshot ? (
          <>
            <p>
              {copy(
                `${filtered.length} matching records · search covers all returned records`,
                `${filtered.length} سجلًا مطابقًا · يشمل البحث كل السجلات المسترجعة`,
              )}
            </p>
            <div className={directStyles.directory}>
              {filtered.slice((shownPage - 1) * 25, shownPage * 25).map((record) => (
                <article className={directStyles.row} key={record.id}>
                  <div>
                    <strong>
                      <bdi>{record.name}</bdi>
                    </strong>
                    {"advertiser" in record ? (
                      <p>
                        <bdi>{record.advertiser.name}</bdi>
                      </p>
                    ) : null}
                  </div>
                  <DataBadge>{statusLabel(record.status)}</DataBadge>
                  <ActionButton
                    tone="secondary"
                    disabled={blocked}
                    onClick={() => c.choose(kind, record)}
                    aria-label={copy(`Edit ${record.name}`, `تعديل ${record.name}`)}
                  >
                    {copy("Edit", "تعديل")}
                  </ActionButton>
                </article>
              ))}
            </div>
            {filtered.length === 0 ? (
              <StatusNotice>
                {rows.length
                  ? copy(
                      "No matching records. Change the search or status filter.",
                      "لا توجد سجلات مطابقة. غيّر البحث أو تصفية الحالة.",
                    )
                  : copy(
                      "No records yet. Create one to get started.",
                      "لا توجد سجلات بعد. أنشئ سجلًا للبدء.",
                    )}
              </StatusNotice>
            ) : null}
            <PageControls
              label={copy("Record pages", "صفحات السجلات")}
              summary={copy(
                `Page ${shownPage} of ${Math.max(1, Math.ceil(filtered.length / 25))}`,
                `الصفحة ${shownPage} من ${Math.max(1, Math.ceil(filtered.length / 25))}`,
              )}
              previousLabel={copy("Previous", "السابق")}
              nextLabel={copy("Next", "التالي")}
              hasPrevious={shownPage > 1}
              hasNext={shownPage * 25 < filtered.length}
              onPrevious={() => setPage(shownPage - 1)}
              onNext={() => setPage(shownPage + 1)}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
function RecordFields({
  editor,
  c,
  disabled,
}: {
  editor: DirectEditor;
  c: Workspace;
  disabled: boolean;
}) {
  return editor.kind === "advertiser" ? (
    <AdvertiserFields
      draft={editor.draft}
      onChange={(draft) => c.edit({ ...editor, draft })}
      disabled={disabled}
    />
  ) : (
    <DirectCampaignFields
      draft={editor.draft}
      onChange={(draft) => c.edit({ ...editor, draft })}
      advertiserOptions={c.snapshot?.advertisers ?? []}
      placements={c.placements}
      targetSearch={c.targetSearch}
      disabled={disabled}
      creating={!editor.original}
    />
  );
}
