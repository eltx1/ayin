"use client";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { AdminHomeRow } from "@/lib/admin-product";

export function AdminRegionalMerchandising({
  rows,
  drafts,
  onDraftChange,
  onSave,
  disabled,
}: {
  rows: AdminHomeRow[];
  drafts: Record<string, string>;
  onDraftChange: (id: string, value: string) => void;
  onSave: (row: AdminHomeRow) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.card} aria-labelledby="regional-merchandising-heading">
      <h2 id="regional-merchandising-heading">{t("merch.regionalTitle")}</h2>
      <p className={styles.muted}>{t("merch.regionalHelp")}</p>
      {rows.length === 0 ? (
        <p>{t("merch.empty")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("merch.row")}</th>
                <th>{t("merch.regions")}</th>
                <th>{t("merch.save")}</th>
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
                      aria-label={t("merch.regionLabel", { row: row.key })}
                      placeholder={t("merch.regionPlaceholder")}
                      value={drafts[row.id] ?? ""}
                      onChange={(event) => onDraftChange(row.id, event.target.value)}
                    />
                  </td>
                  <td>
                    <button type="button" disabled={disabled} onClick={() => onSave(row)}>
                      {t("merch.saveRegions")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
