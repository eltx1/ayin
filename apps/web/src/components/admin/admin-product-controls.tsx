"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ActionButton, TextField } from "@/components/ui/design-system";
import { AdminProductFields } from "./admin-product-fields";
import fields from "./admin-product-fields.module.css";
import {
  productControlsIssueMessage,
  validateProductControlsDraft,
} from "@/lib/admin-product-drafts";
import pickerStyles from "./merchandising-target-picker.module.css";
import { useAdminAccess } from "./admin-access";
import { MerchandisingTargetPicker } from "./merchandising-target-picker";
import {
  targetKey,
  merchandisingIdentityFailure,
  verifiedMerchandisingOperation,
  type MerchandisingSelection,
  type MerchandisingTarget,
} from "@/lib/admin-merchandising";
import type { AdminScopeLease } from "@/lib/admin-session-scope";
import { AdminWorkspaceError, canAdministerOperations } from "@/lib/verified-admin-transport";
import { useI18n } from "@/components/i18n/i18n-provider";
import { AdminRegionalMerchandising } from "./admin-regional-merchandising";
import styles from "@/app/admin/admin.module.css";
import {
  getAdminProductControls,
  mergeHomeRowFields,
  parseRegionTargets,
  patchAdminHomeRow,
  reorderAdminHomeRows,
  replaceAdminHomeRowManualItems,
  updateAdminProductControls,
  type AdminHomeRow,
  type ProductControls,
} from "@/lib/admin-product";

const homeRowSources = [
  "CONTINUE_WATCHING",
  "TRENDING_WORLDWIDE",
  "POPULAR_NOW",
  "NEW_ON_AYIN",
  "BECAUSE_YOU_WATCHED",
  "POPULAR_REGION",
  "MOVIES",
  "SERIES",
  "CREATOR_TV",
  "CREATORS_YOU_FOLLOW",
  "RECENTLY_ADDED",
  "EDITOR_PICKS",
] as const;

export function AdminProductControls() {
  const { t } = useI18n();
  const access = useAdminAccess();
  const { getScopeLease, subscribeScopeInvalidation, invalidateScope, refresh } = access;
  const root = useRef<HTMLDivElement>(null);
  const subscribe = useCallback(
    (notify: () => void) =>
      subscribeScopeInvalidation(() => {
        // Hide native DOM before React cleanup so private selections cannot survive
        // a same-account new session, role change, backgrounding or route review.
        if (root.current) root.current.hidden = true;
        notify();
      }),
    [subscribeScopeInvalidation],
  );
  const getSnapshot = useCallback(() => {
    const current = getScopeLease();
    return current && canAdministerOperations(current.session.roles) ? current : null;
  }, [getScopeLease]);
  // The provider owns the lease. Read its stable object directly, including on
  // provider re-renders after verification; never mirror it into effect state.
  const lease = useSyncExternalStore(subscribe, getSnapshot, () => null);
  useLayoutEffect(() => {
    if (root.current) root.current.hidden = !lease;
  }, [lease]);
  const isCurrent = useCallback(
    () => Boolean(lease && getScopeLease() === lease),
    [getScopeLease, lease],
  );
  return (
    <>
      {!lease &&
        (access.loading ? (
          <p role="status">{t("merch.loading")}</p>
        ) : (
          <section className={styles.card}>
            <p role="alert">{t("merch.loadError")}</p>
            <button type="button" onClick={refresh}>
              {t("merch.retry")}
            </button>
          </section>
        ))}
      <div ref={root} hidden={!lease}>
        {lease && (
          <ProductControlsEditor
            key={lease.epoch}
            lease={lease}
            isCurrent={isCurrent}
            onDenied={invalidateScope}
          />
        )}
      </div>
    </>
  );
}

function ProductControlsEditor({
  lease,
  isCurrent,
  onDenied,
}: {
  lease: AdminScopeLease;
  isCurrent: () => boolean;
  onDenied: () => void;
}) {
  const { t, locale } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const editorId = useId();
  const globalForm = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionDrafts, setRegionDrafts] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<AdminHomeRow[]>([]);
  const [manualDrafts, setManualDrafts] = useState<Record<string, MerchandisingSelection[]>>({});
  const [targets, setTargets] = useState<Record<string, MerchandisingTarget>>({});
  const activeWrite = useRef<AbortController | null>(null);
  const [controls, setControls] = useState<ProductControls | null>(null);
  const [reason, setReason] = useState(
    copy("Routine merchandising update", "تحديث دوري لعرض المحتوى"),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reviewedGlobal, setReviewedGlobal] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void verifiedMerchandisingOperation(lease.session, controller.signal, (signal) =>
      getAdminProductControls(signal, lease.session),
    )
      .then((snapshot) => {
        if (controller.signal.aborted || !isCurrent()) return;
        setRows(snapshot.rows);
        setControls(snapshot.controls);
        setManualDrafts(
          Object.fromEntries(
            snapshot.rows.map((row) => [
              row.id,
              row.manualItems.map((item) => ({
                entityType: item.entityType as MerchandisingSelection["entityType"],
                entityId: item.entityId,
              })),
            ]),
          ),
        );
        setTargets(
          Object.fromEntries(snapshot.selectedTargets.map((target) => [targetKey(target), target])),
        );
        setRegionDrafts(
          Object.fromEntries(snapshot.rows.map((row) => [row.id, row.targetRegions.join(", ")])),
        );
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || !isCurrent()) return;
        if (merchandisingIdentityFailure(cause)) {
          onDenied();
          return;
        }
        setError(cause instanceof Error ? cause.message : "Controls could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      activeWrite.current?.abort();
    };
  }, [revision, lease, isCurrent, onDenied]);

  async function mutate<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    success: string,
    apply: (result: T) => void,
    action = "row",
  ) {
    if (pending.current || !isCurrent() || reason.trim().length < 3) return;
    pending.current = true;
    setBusy(true);
    setPendingAction(action);
    setMessage(null);
    setError(null);
    const controller = new AbortController();
    activeWrite.current = controller;
    try {
      const result = await verifiedMerchandisingOperation(
        lease.session,
        controller.signal,
        (signal) => {
          if (!isCurrent()) throw new AdminWorkspaceError(403);
          return operation(signal);
        },
      );
      if (mounted.current && !controller.signal.aborted && isCurrent()) {
        apply(result);
        setMessage(success);
      }
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || !isCurrent()) return;
      if (merchandisingIdentityFailure(cause)) {
        onDenied();
        return;
      }
      setError(
        cause instanceof AdminWorkspaceError && cause.verificationRequired
          ? copy(
              "Verify your identity, then review and save again. Your draft is preserved.",
              "أكد هويتك، ثم راجع التغيير واحفظه مرة أخرى. تم الاحتفاظ بمسودتك.",
            )
          : `${t("merch.saveError")} ${copy(
              "Review the saved settings before trying again; the request may have reached the server.",
              "راجع الإعدادات المحفوظة قبل المحاولة مرة أخرى؛ ربما وصل الطلب إلى الخادم.",
            )}`,
      );
    } finally {
      pending.current = false;
      activeWrite.current = null;
      if (mounted.current && isCurrent()) {
        setBusy(false);
        setPendingAction(null);
      }
    }
  }

  function saveRegions(row: AdminHomeRow) {
    let targetRegions: string[];
    try {
      targetRegions = parseRegionTargets(regionDrafts[row.id] ?? "");
    } catch {
      setMessage(null);
      setError(t("merch.invalidRegions"));
      return;
    }
    void mutate(
      (signal) => patchAdminHomeRow(row.id, { targetRegions, reason }, signal, lease.session),
      `${t("merch.savedRegions")} (${row.key})`,
      (result) => {
        setRows((current) => mergeHomeRowFields(current, row.id, result, ["targetRegions"]));
        setRegionDrafts((current) => ({ ...current, [row.id]: result.targetRegions.join(", ") }));
      },
    );
  }

  function updateRowDraft(rowId: string, patch: Partial<AdminHomeRow>) {
    setMessage(null);
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function updateControlsDraft(next: ProductControls) {
    setMessage(null);
    setError(null);
    setControls(next);
  }

  function saveGlobalControls() {
    if (!controls) return;
    setReviewedGlobal(true);
    const issue = validateProductControlsDraft(controls);
    if (issue) {
      setMessage(null);
      setError(productControlsIssueMessage(issue, locale));
      requestAnimationFrame(() =>
        globalForm.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-product-error]')
          ?.focus(),
      );
      return;
    }
    void mutate(
      (signal) => updateAdminProductControls(controls, reason, signal, lease.session),
      copy("Global product controls updated.", "تم تحديث إعدادات المنتج العامة."),
      setControls,
      "global",
    );
  }

  function moveRow(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    void mutate(
      (signal) =>
        reorderAdminHomeRows(
          next.map((row) => row.id),
          reason,
          signal,
          lease.session,
        ),
      copy("Home row order updated.", "تم تحديث ترتيب الصفوف."),
      (result) =>
        setRows((current) =>
          result.rowIds.flatMap((id, position) => {
            const row = current.find((item) => item.id === id);
            return row ? [{ ...row, position }] : [];
          }),
        ),
    );
  }

  if (loading)
    return (
      <p role="status" className={styles.muted}>
        {t("merch.loading")}
      </p>
    );
  if (!controls)
    return (
      <section className={styles.card}>
        <p role="alert">{t("merch.loadError")}</p>
        {error && <p className={styles.muted}>{error}</p>}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setLoading(true);
            setRevision((current) => current + 1);
          }}
        >
          {t("merch.retry")}
        </button>
      </section>
    );

  return (
    <fieldset className={styles.workspaceFields} disabled={busy} aria-busy={busy}>
      <legend className={styles.visuallyHidden}>{t("merch.settings")}</legend>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{copy("Product controls", "إعدادات المنتج")}</span>
          <h1>{copy("Home, navigation & merchandising", "الرئيسية والتنقل وعرض المحتوى")}</h1>
          <p className={styles.muted}>
            {copy(
              "Changes are validated and audited before appearing in public discovery.",
              "يتم التحقق من التغييرات وتسجيلها قبل ظهورها في استكشاف المحتوى العام.",
            )}
          </p>
        </div>
      </header>

      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <TextField
        id={`${editorId}-audit-reason`}
        label={t("merch.reason")}
        hint={copy(
          "Explain the change in 3 to 500 characters. Each save records this reason.",
          "اشرح التغيير باستخدام 3 إلى 500 حرف. يُسجّل هذا السبب عند كل عملية حفظ.",
        )}
        required
        minLength={3}
        maxLength={500}
        dir="auto"
        value={reason}
        onChange={(event) => {
          setMessage(null);
          setReason(event.target.value);
        }}
      />

      <section className={styles.card}>
        <h2>{copy("Home Builder", "إعداد الصفحة الرئيسية")}</h2>
        <p className={styles.muted}>
          {copy(
            "Configure rows, audience, limits and Editor Picks for public discovery.",
            "اضبط الصفوف والجمهور والحدود واختيارات المحررين لاستكشاف المحتوى العام.",
          )}
        </p>
        {rows.length === 0 ? <p role="status">{t("merch.empty")}</p> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{copy("Row", "الصف")}</th>
                <th>{copy("Source", "المصدر")}</th>
                <th>{copy("Audience", "الجمهور")}</th>
                <th>{copy("Limit", "الحد")}</th>
                <th>{copy("State", "الحالة")}</th>
                <th>{copy("Order", "الترتيب")}</th>
                <th>{copy("Save", "حفظ")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`${row.key} title`}
                      maxLength={120}
                      value={row.title}
                      onChange={(event) => updateRowDraft(row.id, { title: event.target.value })}
                    />
                    <br />
                    <span className={styles.muted}>{row.key}</span>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={row.regionPersonalizationRequired}
                        onChange={(event) =>
                          updateRowDraft(row.id, {
                            regionPersonalizationRequired: event.target.checked,
                          })
                        }
                      />
                      {copy("Region signal required", "إشارة المنطقة مطلوبة")}
                    </label>
                  </td>
                  <td>
                    <select
                      aria-label={`${row.key} source`}
                      value={row.source}
                      onChange={(event) => updateRowDraft(row.id, { source: event.target.value })}
                    >
                      {homeRowSources.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`${row.key} audience`}
                      value={row.audience}
                      onChange={(event) => updateRowDraft(row.id, { audience: event.target.value })}
                    >
                      <option value="ALL">ALL</option>
                      <option value="AUTHENTICATED">AUTHENTICATED</option>
                      <option value="ANONYMOUS">ANONYMOUS</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`${row.key} item limit`}
                      min={1}
                      max={40}
                      type="number"
                      value={row.maxItems}
                      onChange={(event) =>
                        updateRowDraft(row.id, {
                          maxItems: Math.max(1, Math.min(40, Number(event.target.value))),
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      aria-label={`${row.key} enabled`}
                      disabled={busy || reason.trim().length < 3}
                      onClick={() =>
                        void mutate(
                          (signal) =>
                            patchAdminHomeRow(
                              row.id,
                              { enabled: !row.enabled, reason },
                              signal,
                              lease.session,
                            ),
                          row.enabled
                            ? copy("Row disabled.", "تم تعطيل الصف.")
                            : copy("Row enabled.", "تم تفعيل الصف."),
                          (result) =>
                            setRows((current) =>
                              mergeHomeRowFields(current, row.id, result, ["enabled"]),
                            ),
                        )
                      }
                    >
                      {row.enabled ? copy("On", "مفعّل") : copy("Off", "معطّل")}
                    </button>
                  </td>
                  <td>
                    <button
                      aria-label={`${row.key} move up`}
                      disabled={busy || reason.trim().length < 3 || index === 0}
                      onClick={() => moveRow(index, -1)}
                    >
                      ↑
                    </button>{" "}
                    <button
                      aria-label={`${row.key} move down`}
                      disabled={busy || reason.trim().length < 3 || index === rows.length - 1}
                      onClick={() => moveRow(index, 1)}
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    <button
                      disabled={busy || reason.trim().length < 3 || row.title.trim().length === 0}
                      onClick={() =>
                        void mutate(
                          (signal) =>
                            patchAdminHomeRow(
                              row.id,
                              {
                                title: row.title,
                                source: row.source,
                                audience: row.audience,
                                maxItems: row.maxItems,
                                regionPersonalizationRequired: row.regionPersonalizationRequired,
                                reason,
                              },
                              signal,
                              lease.session,
                            ),
                          copy("Home row updated.", "تم تحديث الصف."),
                          (result) =>
                            setRows((current) =>
                              mergeHomeRowFields(current, row.id, result, [
                                "title",
                                "source",
                                "audience",
                                "maxItems",
                                "regionPersonalizationRequired",
                              ]),
                            ),
                        )
                      }
                    >
                      {copy("Save row", "حفظ الصف")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rows
        .filter((row) => row.source === "EDITOR_PICKS")
        .map((row) => (
          <section className={styles.card} key={row.id}>
            <MerchandisingTargetPicker
              label={copy(`Featured items: ${row.title}`, `المحتوى المميز: ${row.title}`)}
              value={manualDrafts[row.id] ?? []}
              targets={targets}
              actor={lease.session}
              isCurrent={isCurrent}
              onDenied={onDenied}
              disabled={busy}
              onChange={(items, target) => {
                setManualDrafts((current) => ({ ...current, [row.id]: items }));
                if (target) setTargets((current) => ({ ...current, [targetKey(target)]: target }));
              }}
            />
            <ActionButton
              className={pickerStyles.saveAction}
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() =>
                void mutate(
                  (signal) =>
                    replaceAdminHomeRowManualItems(
                      row.id,
                      (manualDrafts[row.id] ?? []).map(({ entityType, entityId }) => ({
                        entityType,
                        entityId,
                      })),
                      reason,
                      signal,
                      lease.session,
                    ),
                  copy("Manual featured items updated.", "تم تحديث المحتوى المميز."),
                  (result) => {
                    setRows((current) =>
                      mergeHomeRowFields(current, row.id, result, ["manualItems"]),
                    );
                    setManualDrafts((current) => ({
                      ...current,
                      [row.id]: result.manualItems.map((item) => ({
                        entityType: item.entityType as MerchandisingSelection["entityType"],
                        entityId: item.entityId,
                      })),
                    }));
                  },
                )
              }
            >
              {copy("Save featured items", "حفظ المحتوى المميز")}
            </ActionButton>
          </section>
        ))}

      <AdminRegionalMerchandising
        rows={rows}
        drafts={regionDrafts}
        onDraftChange={(id, value) => {
          setMessage(null);
          setError(null);
          setRegionDrafts((current) => ({ ...current, [id]: value }));
        }}
        onSave={saveRegions}
        disabled={busy || reason.trim().length < 3}
      />

      <form
        ref={globalForm}
        className={fields.globalForm}
        aria-label={copy("Global product controls", "إعدادات المنتج العامة")}
        onSubmit={(event) => {
          event.preventDefault();
          saveGlobalControls();
        }}
      >
        <p className={styles.muted}>
          {copy(
            "Navigation, Hero, announcement, taxonomy and device visibility are saved together with Save global controls.",
            "يتم حفظ التنقل والمحتوى الرئيسي والإعلان والتصنيفات والعرض حسب الجهاز معًا باستخدام حفظ الإعدادات العامة.",
          )}
        </p>
        <section className={styles.card}>
          <h2>{copy("Main navigation", "التنقل الرئيسي")}</h2>
          <p className={styles.muted}>
            {copy(
              "Toggle feature-ready destinations without redeploying the public shell.",
              "فعّل وجهات التنقل الجاهزة دون إعادة نشر الواجهة العامة.",
            )}
          </p>
          {controls.navigation.map((item, index) => (
            <label className={styles.checkboxRow} key={item.key}>
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(event) => {
                  const navigation = controls.navigation.map((entry, itemIndex) =>
                    itemIndex === index ? { ...entry, enabled: event.target.checked } : entry,
                  );
                  updateControlsDraft({ ...controls, navigation });
                }}
              />
              <span>
                {item.label} <small className={styles.muted}>{item.href}</small>
              </span>
            </label>
          ))}
        </section>

        <section className={styles.card}>
          <MerchandisingTargetPicker
            label={copy("Hero selector", "اختيار المحتوى الرئيسي")}
            emptyMessage={
              Boolean(controls.hero.entityType) !== Boolean(controls.hero.entityId)
                ? copy(
                    "The saved Hero choice is incomplete. Select a target or use automatic selection.",
                    "اختيار المحتوى الرئيسي المحفوظ غير مكتمل. اختر محتوى أو استخدم الاختيار التلقائي.",
                  )
                : undefined
            }
            single
            value={
              controls.hero.entityType && controls.hero.entityId
                ? [{ entityType: controls.hero.entityType, entityId: controls.hero.entityId }]
                : []
            }
            targets={targets}
            actor={lease.session}
            isCurrent={isCurrent}
            onDenied={onDenied}
            disabled={busy}
            onChange={(items, target) => {
              const item = items[0];
              updateControlsDraft({
                ...controls,
                hero: item
                  ? { entityType: item.entityType, entityId: item.entityId }
                  : { entityType: null, entityId: null },
              });
              if (target) setTargets((current) => ({ ...current, [targetKey(target)]: target }));
            }}
          />
          {Boolean(controls.hero.entityType) !== Boolean(controls.hero.entityId) && (
            <button
              type="button"
              onClick={() =>
                updateControlsDraft({ ...controls, hero: { entityType: null, entityId: null } })
              }
            >
              {copy("Use automatic selection", "استخدام الاختيار التلقائي")}
            </button>
          )}
        </section>

        <AdminProductFields
          controls={controls}
          onChange={updateControlsDraft}
          issue={reviewedGlobal ? validateProductControlsDraft(controls) : null}
        />

        <ActionButton
          type="submit"
          disabled={busy || reason.trim().length < 3}
          pending={pendingAction === "global"}
        >
          {pendingAction === "global"
            ? copy("Saving…", "جارٍ الحفظ…")
            : copy("Save global controls", "حفظ الإعدادات العامة")}
        </ActionButton>
      </form>
    </fieldset>
  );
}
