import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { ActionButton } from "./design-system";
import styles from "./data-workspace.module.css";

// Native semantics: fieldsets group controls, tables present data, buttons act.
// These primitives never submit data, sort private records or infer permissions.
export function FieldGroup({
  legend,
  description,
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"fieldset"> & { legend: string; description?: string }) {
  return (
    <fieldset {...props} className={[styles.group, className].filter(Boolean).join(" ")}>
      <legend>{legend}</legend>
      {description ? <p className={styles.description}>{description}</p> : null}
      <div className={styles.fields}>{children}</div>
    </fieldset>
  );
}

export function DataTable({
  caption,
  scrollLabel,
  children,
}: {
  caption: string;
  scrollLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.scroll} role="region" aria-label={scrollLabel} tabIndex={0}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function PageControls({
  label,
  summary,
  previousLabel,
  nextLabel,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  label: string;
  summary: string;
  previousLabel: string;
  nextLabel: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav className={styles.pager} aria-label={label}>
      <span role="status">{summary}</span>
      <div>
        <ActionButton tone="secondary" disabled={!hasPrevious} onClick={onPrevious}>
          {previousLabel}
        </ActionButton>
        <ActionButton tone="secondary" disabled={!hasNext} onClick={onNext}>
          {nextLabel}
        </ActionButton>
      </div>
    </nav>
  );
}
