"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminProductControls,
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

function manualText(row: AdminHomeRow): string {
  return row.manualItems.map((item) => `${item.entityType}:${item.entityId}`).join("\n");
}

export function AdminProductControls() {
  const [rows, setRows] = useState<AdminHomeRow[]>([]);
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [controls, setControls] = useState<ProductControls | null>(null);
  const [reason, setReason] = useState("Routine merchandising update");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applySnapshot(snapshot: Awaited<ReturnType<typeof getAdminProductControls>>) {
    setRows(snapshot.rows);
    setControls(snapshot.controls);
    setManualDrafts(Object.fromEntries(snapshot.rows.map((row) => [row.id, manualText(row)])));
  }

  async function refresh() {
    applySnapshot(await getAdminProductControls());
  }

  useEffect(() => {
    let active = true;
    void getAdminProductControls()
      .then((snapshot) => {
        if (!active) return;
        setRows(snapshot.rows);
        setControls(snapshot.controls);
        setManualDrafts(
          Object.fromEntries(snapshot.rows.map((row) => [row.id, manualText(row)])),
        );
      })
      .catch((error) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Controls could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function mutate(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
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
    );
  }

  function parseManualItems(rowId: string) {
    const lines = (manualDrafts[rowId] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => {
      const [entityType, entityId] = line.split(":", 2);
      if (!entityType || !entityId || !["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"].includes(entityType)) {
        throw new Error("Manual items must use TYPE:UUID, one per line.");
      }
      return {
        entityType: entityType as "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST",
        entityId,
      };
    });
  }

  if (!controls) return <p className={styles.muted}>Loading product controls…</p>;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Product controls</span>
          <h1>Home, navigation & merchandising</h1>
          <p className={styles.muted}>
            Changes are validated, audited and consumed from data rather than hard-coded page rules.
          </p>
        </div>
      </header>

      <label className={styles.field}>
        <span>Audit reason</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {message ? <p className={styles.muted}>{message}</p> : null}

      <section className={styles.card}>
        <h2>Home Builder</h2>
        <p className={styles.muted}>
          Rename, source, audience, limits, regional requirements and manual Editor Picks update the public discovery feed without a deployment.
        </p>
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
                      max={100}
                      type="number"
                      value={row.maxItems}
                      onChange={(event) =>
                        updateRowDraft(row.id, {
                          maxItems: Math.max(1, Math.min(100, Number(event.target.value))),
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () => patchAdminHomeRow(row.id, { enabled: !row.enabled, reason }),
                          row.enabled ? "Row disabled." : "Row enabled.",
                        )
                      }
                    >
                      {row.enabled ? "On" : "Off"}
                    </button>
                  </td>
                  <td>
                    <button disabled={busy || index === 0} onClick={() => moveRow(index, -1)}>
                      ↑
                    </button>{" "}
                    <button
                      disabled={busy || index === rows.length - 1}
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
          )
        }
      >
        {busy ? "Saving…" : "Save global controls"}
      </button>
    </>
  );
}
