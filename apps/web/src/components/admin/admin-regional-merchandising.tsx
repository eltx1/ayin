"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { getAdminProductControls, patchAdminHomeRow, type AdminHomeRow } from "@/lib/admin-product";

export function AdminRegionalMerchandising() {
  const [rows, setRows] = useState<AdminHomeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("Regional merchandising update");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const snapshot = await getAdminProductControls();
    setRows(snapshot.rows);
    setDrafts(
      Object.fromEntries(snapshot.rows.map((row) => [row.id, row.targetRegions.join(", ")])),
    );
  }

  useEffect(() => {
    let active = true;
    void getAdminProductControls()
      .then((snapshot) => {
        if (!active) return;
        setRows(snapshot.rows);
        setDrafts(
          Object.fromEntries(snapshot.rows.map((row) => [row.id, row.targetRegions.join(", ")])),
        );
      })
      .catch((error) => {
        if (active) {
          setMessage(
            error instanceof Error ? error.message : "Regional targets could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function parseRegions(value: string): string[] {
    const regions = value
      .split(/[\s,]+/)
      .map((region) => region.trim().toUpperCase())
      .filter(Boolean);
    const invalid = regions.find((region) => !/^[A-Z]{2}$/.test(region));
    if (invalid) {
      throw new Error(`Invalid region code: ${invalid}. Use two-letter country codes.`);
    }
    return [...new Set(regions)];
  }

  async function save(row: AdminHomeRow) {
    setBusy(true);
    setMessage(null);
    try {
      const targetRegions = parseRegions(drafts[row.id] ?? "");
      await patchAdminHomeRow(row.id, { targetRegions, reason });
      await refresh();
      setMessage(
        targetRegions.length
          ? `${row.title} now targets ${targetRegions.join(", ")}.`
          : `${row.title} is global again.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Regional targets could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <h2>Regional merchandising</h2>
      <p className={styles.muted}>
        Optional two-letter region targets control where a Home row is merchandised. Leave a row
        blank to keep it global. AYIN has no default country; targeting uses only trusted coarse
        region signals and never requires storing viewer IP addresses.
      </p>
      <label className={styles.field}>
        <span>Audit reason</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {message ? <p className={styles.muted}>{message}</p> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Home row</th>
              <th>Target regions</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.title}
                  <br />
                  <span className={styles.muted}>{row.key}</span>
                </td>
                <td>
                  <input
                    aria-label={`${row.key} target regions`}
                    placeholder="Global (blank) or DE, JP, BR"
                    value={drafts[row.id] ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [row.id]: event.target.value,
                      }))
                    }
                  />
                </td>
                <td>
                  <button
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void save(row)}
                  >
                    Save regions
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
