"use client";

import { useId, useRef } from "react";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, TextAreaField, TextField } from "@/components/ui/design-system";
import type { ProductControls } from "@/lib/admin-product";
import {
  appendTaxonomyItem,
  productControlsIssueMessage,
  updateTaxonomyLabel,
  type ProductControlsIssue,
} from "@/lib/admin-product-drafts";
import fields from "./admin-product-fields.module.css";

export function AdminProductFields({
  controls,
  onChange,
  issue,
}: {
  controls: ProductControls;
  onChange: (controls: ProductControls) => void;
  issue: ProductControlsIssue | null;
}) {
  const { locale } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const id = useId();
  const taxonomyRoot = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLDivElement>(null);
  const announcement = controls.announcement;
  const updateAnnouncement = (patch: Partial<ProductControls["announcement"]>) =>
    onChange({ ...controls, announcement: { ...announcement, ...patch } });

  return (
    <>
      <section className={`${styles.card} ${fields.panel}`} aria-labelledby={`${id}-announcement`}>
        <h2 id={`${id}-announcement`}>{copy("Announcement", "الإعلان")}</h2>
        <label className={fields.check}>
          <input
            type="checkbox"
            checked={announcement.enabled}
            onChange={(event) => updateAnnouncement({ enabled: event.target.checked })}
          />
          {copy("Show announcement", "إظهار الإعلان")}
        </label>
        <TextAreaField
          id={`${id}-announcement-text`}
          label={copy("Announcement text", "نص الإعلان")}
          hint={copy(
            "Up to 240 characters. Your text is kept when the announcement is hidden.",
            "حتى 240 حرفًا. يُحتفظ بالنص عند إخفاء الإعلان.",
          )}
          error={
            issue === "announcementText" ? productControlsIssueMessage(issue, locale) : undefined
          }
          dir="auto"
          rows={3}
          maxLength={240}
          required={announcement.enabled}
          value={announcement.text}
          placeholder={copy("Platform announcement", "إعلان المنصة")}
          onChange={(event) => updateAnnouncement({ text: event.target.value })}
        />
        <TextField
          id={`${id}-announcement-link`}
          label={copy("Announcement link (optional)", "رابط الإعلان (اختياري)")}
          hint={copy(
            "Use an internal path such as /tv. Leave blank for an announcement without a link.",
            "استخدم مسارًا داخليًا مثل /tv. اتركه فارغًا لعرض الإعلان دون رابط.",
          )}
          error={
            issue === "announcementHref" ? productControlsIssueMessage(issue, locale) : undefined
          }
          dir="ltr"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={160}
          value={announcement.href ?? ""}
          placeholder="/tv"
          onChange={(event) => updateAnnouncement({ href: event.target.value || null })}
        />
      </section>

      <section className={`${styles.card} ${fields.panel}`} aria-labelledby={`${id}-taxonomy`}>
        <h2 id={`${id}-taxonomy`}>{copy("Taxonomy", "التصنيفات")}</h2>
        <p id={`${id}-taxonomy-help`} className={styles.muted}>
          {copy(
            "Edit category labels in any language. Saved keys and enabled states are kept when labels change. Remove a category only with its Remove button. Up to 100 categories.",
            "عدّل أسماء التصنيفات بأي لغة. يُحتفظ بالمعرّفات وحالات التفعيل عند تغيير الأسماء. استخدم زر إزالة لحذف تصنيف. الحد الأقصى 100 تصنيف.",
          )}
        </p>
        {issue?.startsWith("taxonomy") && (
          <p id={`${id}-taxonomy-error`} className={fields.error} tabIndex={-1} data-product-error>
            {productControlsIssueMessage(issue, locale)}
          </p>
        )}
        {!controls.taxonomy.length && (
          <p className={styles.muted}>
            {copy("No categories configured.", "لا توجد تصنيفات مُعدّة.")}
          </p>
        )}
        <div ref={taxonomyRoot} className={fields.list}>
          {controls.taxonomy.map((item, index) => (
            <fieldset
              className={fields.taxonomyItem}
              key={item.key}
              aria-describedby={`${id}-taxonomy-help`}
            >
              <legend>{copy(`Category ${index + 1}`, `التصنيف ${index + 1}`)}</legend>
              <TextField
                id={`${id}-category-${index}`}
                label={copy("Category label", "اسم التصنيف")}
                dir="auto"
                value={item.label}
                maxLength={80}
                required
                aria-invalid={issue === "taxonomyLabel" && !item.label.trim() ? true : undefined}
                aria-describedby={
                  issue?.startsWith("taxonomy") ? `${id}-taxonomy-error` : undefined
                }
                onChange={(event) =>
                  onChange({
                    ...controls,
                    taxonomy: updateTaxonomyLabel(controls.taxonomy, index, event.target.value),
                  })
                }
              />
              <p className={fields.key}>
                {copy("Stable key:", "المعرّف الثابت:")} <span dir="ltr">{item.key}</span>
              </p>
              <div className={fields.actions}>
                <label className={fields.check}>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) =>
                      onChange({
                        ...controls,
                        taxonomy: controls.taxonomy.map((entry, position) =>
                          position === index ? { ...entry, enabled: event.target.checked } : entry,
                        ),
                      })
                    }
                  />
                  {copy("Category enabled", "التصنيف مفعّل")}
                </label>
                <ActionButton
                  tone="quiet"
                  type="button"
                  aria-label={copy(`Remove category ${index + 1}`, `إزالة التصنيف ${index + 1}`)}
                  onClick={() => {
                    onChange({
                      ...controls,
                      taxonomy: controls.taxonomy.filter((_, position) => position !== index),
                    });
                    addButton.current?.querySelector("button")?.focus();
                  }}
                >
                  {copy("Remove", "إزالة")}
                </ActionButton>
              </div>
            </fieldset>
          ))}
        </div>
        <div ref={addButton}>
          <ActionButton
            tone="secondary"
            type="button"
            disabled={controls.taxonomy.length >= 100}
            onClick={() => {
              onChange({ ...controls, taxonomy: appendTaxonomyItem(controls.taxonomy) });
              // Wait for the new native field to exist, then continue keyboard editing there.
              requestAnimationFrame(() =>
                taxonomyRoot.current
                  ?.querySelector<HTMLInputElement>("fieldset:last-child input")
                  ?.focus(),
              );
            }}
          >
            {copy("Add category", "إضافة تصنيف")}
          </ActionButton>
        </div>
      </section>

      <section className={`${styles.card} ${fields.panel}`} aria-labelledby={`${id}-devices`}>
        <h2 id={`${id}-devices`}>{copy("Device visibility", "العرض حسب الجهاز")}</h2>
        <p id={`${id}-devices-help`} className={styles.muted}>
          {copy(
            "Choose which devices show the viewer navigation. These settings do not restrict access to content or links.",
            "اختر الأجهزة التي تعرض تنقل المشاهد. لا تمنع هذه الإعدادات الوصول إلى المحتوى أو الروابط.",
          )}
        </p>
        <div className={fields.devices}>
          {(
            [
              ["web", copy("Web navigation", "التنقل على الويب")],
              ["mobile", copy("Mobile navigation", "التنقل على الهاتف")],
              ["tv", copy("TV navigation", "التنقل على التلفزيون")],
            ] as const
          ).map(([device, label]) => (
            <label className={fields.check} key={device}>
              <input
                type="checkbox"
                aria-describedby={`${id}-devices-help`}
                checked={controls.deviceVisibility[device]}
                onChange={(event) =>
                  onChange({
                    ...controls,
                    deviceVisibility: {
                      ...controls.deviceVisibility,
                      [device]: event.target.checked,
                    },
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
