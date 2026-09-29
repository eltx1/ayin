"use client";

import { useId, useRef, type ReactNode } from "react";

import styles from "./editor-tabs.module.css";

export type EditorTab = { id: string; label: string; content: ReactNode };

// Manual activation: arrows move focus, Enter/Space/click select. Panels stay
// mounted so switching sections never loses an upload picker or unsaved fields.
export function EditorTabs({
  label,
  tabs,
  value,
  onChange,
  direction = "ltr",
}: {
  label: string;
  tabs: readonly EditorTab[];
  value: string;
  onChange: (id: string) => void;
  direction?: "ltr" | "rtl";
}) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = tabs.some((tab) => tab.id === value) ? value : tabs[0]?.id;
  return (
    <div className={styles.root} dir={direction}>
      <div role="tablist" aria-label={label} className={styles.tabs}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === tab.id}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              let next: number;
              if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                const right = event.key === "ArrowRight";
                const forward = direction === "rtl" ? !right : right;
                next = (index + (forward ? 1 : -1) + tabs.length) % tabs.length;
              } else return;
              event.preventDefault();
              event.stopPropagation();
              buttons.current[next]?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={selected !== tab.id}
          tabIndex={0}
          className={styles.panel}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
