"use client";

import { useEffect, useRef, useState } from "react";

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

function manualText(row: Pick<AdminHomeRow, "manualItems">): string {
  return row.manualItems.map((item) => `${item.entityType}:${item.entityId}`).join("\n");
}

export function AdminProductControls() {
  const { t } = useI18n();
  const mounted = useRef(true);
  const pending = useRef(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionDrafts, setRegionDrafts] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<AdminHomeRow[]>([]);
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [controls, setControls] = useState<ProductControls | null>(null);
  const [reason, setReason] = useState("Routine merchandising update");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void getAdminProductControls(controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setRows(snapshot.rows);
        setControls(snapshot.controls);
        setManualDrafts(Object.fromEntries(snapshot.rows.map((row) => [row.id, manualText(row)])));
        setRegionDrafts(
          Object.fromEntries(snapshot.rows.map((row) => [row.id, row.targetRegions.join(", ")])),
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Controls could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [revision]);

  async function mutate<T>(
    operation: () => Promise<T>,
    success: string,
    apply: (result: T) => void,
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await operation();
      if (mounted.current) {
        apply(result);
        setMessage(success);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t("merch.saveError"));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function saveRegions(row: AdminHomeRow) {
    void mutate(
      () => {
        let targetRegions: string[];
        try {
          targetRegions = parseRegionTargets(regionDrafts[row.id] ?? "");
        } catch {
          throw new Error(t("merch.invalidRegions"));
        }
        return patchAdminHomeRow(row.id, { targetRegions, reason });
      },
      t("merch.savedRegions"),
      (result) => {
        setRows((current) => mergeHomeRowFields(current, row.id, result, ["targetRegions"]));
        setRegionDrafts((current) => ({ ...current, [row.id]: result.targetRegions.join(", ") }));
      },
    );
  }

  function updateRowDraft(rowId: string, patch: Partial<AdminHomeRow>) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
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
      () =>
        reorderAdminHomeRows(
          next.map((row) => row.id),
          reason,
        ),
      "Home row order updated.",
      (result) =>
        setRows((current) =>
          result.rowIds.flatMap((id, position) => {
            const row = current.find((item) => item.id === id);
            return row ? [{ ...row, position }] : [];
          }),
        ),
    );
  }

  function parseManualItems(rowId: string) {
    const lines = (manualDrafts[rowId] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => {
      const [entityType, entityId] = line.split(":", 2);
      if (
        !entityType ||
        !entityId ||
        !["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"].includes(entityType)
      ) {
        throw new Error("Manual items must use TYPE:UUID, one per line.");
      }
      return {
        entityType: entityType as "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST",
        entityId,
      };
    });
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
          <span className={styles.eyebrow}>Product controls</span>
          <h1>Home, navigation & merchandising</h1>
          <p className={styles.muted}>
            Changes are validated, audited and consumed from data rather than hard-coded page rules.
          </p>
        </div>
      </header>

      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <label className={styles.field}>
        <span>{t("merch.reason")}</span>
        <input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>

      <section className={styles.card}>
        <h2>Home Builder</h2>
        <p className={styles.muted}>
          Rename, source, audience, limits, regional requirements and manual Editor Picks update the
          public discovery feed without a deployment.
        </p>
        {rows.length === 0 ? <p role="status">{t("merch.empty")}</p> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Row</th>
                <th>Source</th>
                <th>Audience</th>
                <th>Limit</th>
                <th>State</th>
                <th>Order</th>
                <th>Save</th>
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
                      Region signal required
                    </label>
                    {row.source === "EDITOR_PICKS" ? (
                      <>
                        <textarea
                          aria-label={`${row.key} manual items`}
                          placeholder={"VIDEO:uuid\nCHANNEL:uuid"}
                          value={manualDrafts[row.id] ?? ""}
                          onChange={(event) =>
                            setManualDrafts((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          disabled={busy || reason.trim().length < 3}
                          onClick={() =>
                            void mutate(
                              () =>
                                replaceAdminHomeRowManualItems(
                                  row.id,
                                  parseManualItems(row.id),
                                  reason,
                                ),
                              "Manual featured items updated.",
                              (result) => {
                                setRows((current) =>
                                  mergeHomeRowFields(current, row.id, result, ["manualItems"]),
                                );
                                setManualDrafts((current) => ({
                                  ...current,
                                  [row.id]: manualText(result),
                                }));
                              },
                            )
                          }
                        >
                          Save featured items
                        </button>
                      </>
                    ) : null}
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
                          () => patchAdminHomeRow(row.id, { enabled: !row.enabled, reason }),
                          row.enabled ? "Row disabled." : "Row enabled.",
                          (result) =>
                            setRows((current) =>
                              mergeHomeRowFields(current, row.id, result, ["enabled"]),
                            ),
                        )
                      }
                    >
                      {row.enabled ? "On" : "Off"}
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
                          () =>
                            patchAdminHomeRow(row.id, {
                              title: row.title,
                              source: row.source,
                              audience: row.audience,
                              maxItems: row.maxItems,
                              regionPersonalizationRequired: row.regionPersonalizationRequired,
                              reason,
                            }),
                          "Home row updated.",
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
                      Save row
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AdminRegionalMerchandising
        rows={rows}
        drafts={regionDrafts}
        onDraftChange={(id, value) => setRegionDrafts((current) => ({ ...current, [id]: value }))}
        onSave={saveRegions}
        disabled={busy || reason.trim().length < 3}
      />

      <section className={styles.card}>
        <h2>Main navigation</h2>
        <p className={styles.muted}>
          Toggle feature-ready destinations without redeploying the public shell.
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
                setControls({ ...controls, navigation });
              }}
            />
            <span>
              {item.label} <small className={styles.muted}>{item.href}</small>
            </span>
          </label>
        ))}
      </section>

      <section className={styles.card}>
        <h2>Hero selector</h2>
        <div className={styles.filters}>
          <select
            value={controls.hero.entityType ?? ""}
            onChange={(event) =>
              setControls({
                ...controls,
                hero: {
                  ...controls.hero,
                  entityType: (event.target.value || null) as ProductControls["hero"]["entityType"],
                },
              })
            }
          >
            <option value="">Automatic / none</option>
            <option value="VIDEO">Video</option>
            <option value="CREATOR_TV">Creator TV</option>
            <option value="CHANNEL">Channel</option>
            <option value="PLAYLIST">Playlist</option>
          </select>
          <input
            placeholder="Stable entity UUID"
            value={controls.hero.entityId ?? ""}
            onChange={(event) =>
              setControls({
                ...controls,
                hero: { ...controls.hero, entityId: event.target.value || null },
              })
            }
          />
        </div>
      </section>

      <section className={styles.card}>
        <h2>Announcement</h2>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={controls.announcement.enabled}
            onChange={(event) =>
              setControls({
                ...controls,
                announcement: { ...controls.announcement, enabled: event.target.checked },
              })
            }
          />{" "}
          Enabled
        </label>
        <input
          value={controls.announcement.text}
          maxLength={240}
          placeholder="Platform announcement"
          onChange={(event) =>
            setControls({
              ...controls,
              announcement: { ...controls.announcement, text: event.target.value },
            })
          }
        />
        <input
          value={controls.announcement.href ?? ""}
          placeholder="Optional internal path, e.g. /tv"
          onChange={(event) =>
            setControls({
              ...controls,
              announcement: { ...controls.announcement, href: event.target.value || null },
            })
          }
        />
      </section>

      <section className={styles.card}>
        <h2>Taxonomy</h2>
        <p className={styles.muted}>
          Comma-separated category labels create normalized, admin-managed taxonomy keys.
        </p>
        <textarea
          value={controls.taxonomy.map((item) => item.label).join(", ")}
          onChange={(event) => {
            const taxonomy = event.target.value
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean)
              .slice(0, 100)
              .map((label) => ({
                key: label
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 60),
                label,
                enabled: true,
              }))
              .filter((item) => item.key.length > 0);
            setControls({ ...controls, taxonomy });
          }}
        />
      </section>

      <section className={styles.card}>
        <h2>Device visibility</h2>
        {(["web", "mobile", "tv"] as const).map((device) => (
          <label className={styles.checkboxRow} key={device}>
            <input
              type="checkbox"
              checked={controls.deviceVisibility[device]}
              onChange={(event) =>
                setControls({
                  ...controls,
                  deviceVisibility: {
                    ...controls.deviceVisibility,
                    [device]: event.target.checked,
                  },
                })
              }
            />{" "}
            {device.toUpperCase()}
          </label>
        ))}
      </section>

      <button
        disabled={busy || reason.trim().length < 3}
        onClick={() =>
          void mutate(
            () => updateAdminProductControls(controls, reason),
            "Global product controls updated.",
            setControls,
          )
        }
      >
        {busy ? "Saving…" : "Save global controls"}
      </button>
    </fieldset>
  );
}
