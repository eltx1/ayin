import type { ComponentPropsWithoutRef, Key, ReactNode } from "react";

import { ActionButton } from "./design-system";
import styles from "./data-presentation.module.css";

export type TableColumn<Row> = {
  key: string;
  heading: string;
  render: (row: Row) => ReactNode;
  rowHeader?: boolean;
  compact?: boolean;
};

// Real tabular data only. Captions and explicit header scopes remain native;
// overflow stays inside a labelled keyboard-scrollable region, never the page.
export function DataTable<Row>({
  caption,
  scrollLabel = caption,
  rows,
  columns,
  rowKey,
}: {
  caption: string;
  scrollLabel?: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => Key;
}) {
  return (
    <div className={styles.tableRegion} role="region" aria-label={scrollLabel} tabIndex={0}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-compact={column.compact || undefined}>
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) =>
                column.rowHeader ? (
                  <th scope="row" key={column.key}>
                    {column.render(row)}
                  </th>
                ) : (
                  <td key={column.key}>{column.render(row)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Native disclosure gives keyboard and assistive-technology semantics without a
// second JS state machine or custom aria-expanded state that can drift.
export function Disclosure({
  summary,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"details">, "children"> & {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <details {...props} className={[styles.disclosure, className].filter(Boolean).join(" ")}>
      <summary>{summary}</summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
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
