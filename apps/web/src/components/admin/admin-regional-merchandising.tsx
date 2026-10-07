"use client";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { AdminHomeRow } from "@/lib/admin-product";
import { ActionButton, TextField } from "@/components/ui/design-system";
import fields from "./admin-product-fields.module.css";

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
    <section
      className={`${styles.card} ${fields.panel}`}
      aria-labelledby="regional-merchandising-heading"
    >
      <h2 id="regional-merchandising-heading">{t("merch.regionalTitle")}</h2>
      <p className={styles.muted}>{t("merch.regionalHelp")}</p>
      {rows.length === 0 ? (
        <p>{t("merch.empty")}</p>
      ) : (
        <div className={fields.list}>
          {rows.map((row) => (
            <form
              key={row.id}
              className={fields.regionalItem}
              aria-labelledby={`regional-row-${row.id}`}
              onSubmit={(event) => {
                event.preventDefault();
                if (!disabled) onSave(row);
              }}
            >
              <div className={fields.regionalIdentity}>
                <h3 id={`regional-row-${row.id}`} dir="auto">
                  {row.title}
                </h3>
                <span className={styles.muted} dir="ltr">
                  {row.key}
                </span>
              </div>
              <TextField
                id={`regional-target-${row.id}`}
                label={t("merch.regionLabel", { row: row.key })}
                placeholder={t("merch.regionPlaceholder")}
                dir="ltr"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={drafts[row.id] ?? ""}
                onChange={(event) => onDraftChange(row.id, event.target.value)}
              />
              <ActionButton type="submit" disabled={disabled}>
                {t("merch.saveRegions")}
              </ActionButton>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
