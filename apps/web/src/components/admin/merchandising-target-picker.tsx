"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  DataBadge,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import {
  merchandisingTypes,
  merchandisingIdentityFailure,
  searchMerchandisingTargets,
  targetKey,
  type MerchandisingSelection,
  type MerchandisingTarget,
  type MerchandisingType,
} from "@/lib/admin-merchandising";
import type { DirectAdminSession } from "@/lib/admin-session-scope";
import styles from "./merchandising-target-picker.module.css";

type Directory = Awaited<ReturnType<typeof searchMerchandisingTargets>>;
export function MerchandisingTargetPicker({
  label,
  value,
  targets,
  actor,
  disabled,
  single = false,
  emptyMessage,
  isCurrent,
  onDenied,
  onChange,
}: {
  label: string;
  value: MerchandisingSelection[];
  targets: Record<string, MerchandisingTarget>;
  actor: DirectAdminSession;
  disabled: boolean;
  single?: boolean;
  emptyMessage?: string | undefined;
  isCurrent: () => boolean;
  onDenied: () => void;
  onChange: (value: MerchandisingSelection[], target?: MerchandisingTarget) => void;
}) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  const id = useId();
  const [type, setType] = useState<MerchandisingType>("VIDEO"),
    [query, setQuery] = useState("");
  const [result, setResult] = useState<Directory | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [page, setPage] = useState(1);
  const request = useRef<AbortController | null>(null);
  const typeLabel = (type: MerchandisingType) =>
    ({
      VIDEO: copy("Video", "فيديو"),
      CHANNEL: copy("Channel", "قناة"),
      CREATOR_TV: copy("Creator TV", "تلفزيون المبدع"),
      PLAYLIST: copy("Playlist", "قائمة تشغيل"),
    })[type];
  const displayDetail = (detail: string) => {
    if (!ar) return detail;
    const statuses: Record<string, string> = {
      PUBLIC: "عام",
      PRIVATE: "خاص",
      UNLISTED: "غير مدرج",
      REMOVED: "محذوف",
      DELETED: "محذوف",
      PUBLISHED: "منشور",
      DRAFT: "مسودة",
      SCHEDULED: "مجدول",
      UPLOADING: "جارٍ الرفع",
      VALIDATING: "جارٍ التحقق",
      ACTIVE: "نشط",
      HIDDEN: "مخفي",
      SUSPENDED: "موقوف",
      OFF_AIR: "خارج البث",
      DISABLED: "معطّل",
    };
    return detail
      .split(" · ")
      .map((part) => statuses[part] ?? part)
      .join(" · ");
  };
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort();
    request.current = null;
    setResult(null);
    setLoading(false);
    setError(false);
    setPage(1);
  }
  async function search(nextPage: number) {
    if (disabled || !isCurrent()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    setResult(null);
    setPage(nextPage);
    try {
      const next = await searchMerchandisingTargets(
        actor,
        type,
        query,
        nextPage,
        controller.signal,
      );
      if (request.current !== controller || controller.signal.aborted || !isCurrent()) return;
      setResult(next);
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller || !isCurrent()) return;
      if (merchandisingIdentityFailure(cause)) onDenied();
      else setError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  const change = (next: MerchandisingSelection[], target?: MerchandisingTarget) => {
    if (!disabled && isCurrent()) onChange(next, target);
  };
  return (
    <section className={styles.picker} aria-label={label}>
      <h3>{label}</h3>
      <p className={styles.hint}>
        {copy(
          "Choose by title or name. Public availability, region and audience rules still apply when the selection is shown.",
          "اختر بالعنوان أو الاسم. تظل قواعد الإتاحة العامة والمنطقة والجمهور مطبقة عند عرض الاختيار.",
        )}
      </p>
      <div
        className={styles.selected}
        role="group"
        aria-label={copy("Current selection", "الاختيار الحالي")}
      >
        {value.length === 0 ? (
          <StatusNotice>
            {emptyMessage ??
              (single
                ? copy("Automatic / none", "تلقائي / بلا اختيار")
                : copy("No featured items selected.", "لم يتم اختيار محتوى مميز."))}
          </StatusNotice>
        ) : (
          <ol className={styles.list}>
            {value.map((item, index) => {
              const target = targets[targetKey(item)];
              const name = target?.label ?? copy("Unavailable selection", "اختيار غير متاح");
              return (
                <li key={targetKey(item)} className={styles.item}>
                  <div className={styles.identity}>
                    <DataBadge>{typeLabel(item.entityType)}</DataBadge>
                    <strong dir="auto">{name}</strong>
                    {target ? (
                      <small dir="auto">{displayDetail(target.detail)}</small>
                    ) : (
                      <small>
                        {copy(
                          "The exact label could not be recovered. This saved choice is retained until you replace or remove it.",
                          "تعذر استعادة الاسم الدقيق. يُحتفظ بهذا الاختيار المحفوظ حتى تستبدله أو تزيله.",
                        )}
                      </small>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {!single && (
                      <>
                        <ActionButton
                          type="button"
                          tone="quiet"
                          disabled={disabled || index === 0}
                          aria-label={copy(`Move ${name} up`, `نقل ${name} للأعلى`)}
                          onClick={() => {
                            const next = [...value];
                            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                            change(next);
                          }}
                        >
                          ↑
                        </ActionButton>
                        <ActionButton
                          type="button"
                          tone="quiet"
                          disabled={disabled || index === value.length - 1}
                          aria-label={copy(`Move ${name} down`, `نقل ${name} للأسفل`)}
                          onClick={() => {
                            const next = [...value];
                            [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                            change(next);
                          }}
                        >
                          ↓
                        </ActionButton>
                      </>
                    )}
                    <ActionButton
                      type="button"
                      tone="quiet"
                      disabled={disabled}
                      aria-label={copy(`Remove ${name}`, `إزالة ${name}`)}
                      onClick={() => change(value.filter((_, i) => i !== index))}
                    >
                      {copy("Remove", "إزالة")}
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className={styles.search}>
        <SelectField
          id={`${id}-type`}
          label={copy("Content type", "نوع المحتوى")}
          value={type}
          disabled={disabled}
          onChange={(event) => {
            reset();
            setType(event.target.value as MerchandisingType);
          }}
        >
          {merchandisingTypes.map((item) => (
            <option key={item} value={item}>
              {typeLabel(item)}
            </option>
          ))}
        </SelectField>
        <TextField
          id={`${id}-search`}
          type="search"
          label={copy("Find content", "البحث عن المحتوى")}
          hint={copy(
            "Search by title, name or slug. Browse up to 25 matches per page.",
            "ابحث بالعنوان أو الاسم أو الرابط المختصر. تصفح حتى 25 نتيجة في الصفحة.",
          )}
          maxLength={200}
          value={query}
          disabled={disabled}
          onChange={(event) => {
            reset();
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search(1);
            }
          }}
        />
        <ActionButton type="button" disabled={disabled || loading} onClick={() => void search(1)}>
          {copy("Search content", "بحث عن محتوى")}
        </ActionButton>
      </div>
      {loading && (
        <StatusNotice announce="polite">
          {copy("Loading matching content…", "جارٍ تحميل المحتوى المطابق…")}
        </StatusNotice>
      )}
      {error && (
        <StatusNotice tone="danger" announce="assertive">
          {copy(
            "Content could not be loaded. Your selection is unchanged.",
            "تعذر تحميل المحتوى. لم يتغير اختيارك.",
          )}{" "}
          <ActionButton
            type="button"
            tone="secondary"
            disabled={disabled}
            onClick={() => void search(page)}
          >
            {copy("Retry content search", "إعادة محاولة البحث")}
          </ActionButton>
        </StatusNotice>
      )}
      {result && (
        <>
          <p role="status" className={styles.hint}>
            {ar
              ? `الصفحة ${result.pagination.page} من ${result.pagination.pages} · ${result.pagination.total} نتيجة`
              : `Page ${result.pagination.page} of ${result.pagination.pages} · ${result.pagination.total} matches`}
          </p>
          {!result.items.length && (
            <StatusNotice>
              {copy(
                "No content matches this search. Try another name or content type.",
                "لا يوجد محتوى مطابق لهذا البحث. جرّب اسمًا أو نوع محتوى آخر.",
              )}
            </StatusNotice>
          )}
          <ul className={styles.list} aria-label={copy("Search results", "نتائج البحث")}>
            {result.items.map((item) => {
              const selected = value.some((current) => targetKey(current) === targetKey(item));
              return (
                <li key={targetKey(item)} className={styles.item}>
                  <div className={styles.identity}>
                    <strong dir="auto">{item.label}</strong>
                    <small dir="auto">{displayDetail(item.detail)}</small>
                  </div>
                  <ActionButton
                    type="button"
                    tone="secondary"
                    disabled={disabled || selected || (!single && value.length >= 100)}
                    aria-label={copy(`Select ${item.label}`, `اختيار ${item.label}`)}
                    onClick={() => change(single ? [item] : [...value, item], item)}
                  >
                    {selected ? copy("Selected", "محدد") : copy("Select", "اختيار")}
                  </ActionButton>
                </li>
              );
            })}
          </ul>
          <nav
            className={styles.actions}
            aria-label={copy("Content search pages", "صفحات نتائج المحتوى")}
          >
            <ActionButton
              type="button"
              tone="secondary"
              disabled={disabled || page <= 1}
              onClick={() => void search(page - 1)}
            >
              {copy("Previous", "السابق")}
            </ActionButton>
            <ActionButton
              type="button"
              tone="secondary"
              disabled={disabled || page >= result.pagination.pages || page >= 10_000}
              onClick={() => void search(page + 1)}
            >
              {copy("Next", "التالي")}
            </ActionButton>
          </nav>
        </>
      )}
      {!single && value.length >= 100 && (
        <StatusNotice>
          {copy(
            "Maximum 100 featured items. Remove an item before adding another.",
            "الحد الأقصى 100 عنصر مميز. أزل عنصرًا قبل إضافة آخر.",
          )}
        </StatusNotice>
      )}
    </section>
  );
}
