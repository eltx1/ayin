import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { Button } from "@ayin/ui";

import styles from "./design-system.module.css";

type ActionTone = "primary" | "secondary" | "quiet" | "danger";
type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
const classes = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ");

export function ActionButton({
  tone = "primary",
  pending = false,
  disabled,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & { tone?: ActionTone; pending?: boolean }) {
  return (
    <Button
      {...props}
      className={classes(styles.action, className)}
      data-tone={tone}
      aria-busy={pending || props["aria-busy"]}
      disabled={disabled || pending}
    >
      {pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

// Links stay native navigation, not disabled-looking buttons with live click targets.
export function ActionLink({
  tone = "secondary",
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & { tone?: Exclude<ActionTone, "danger"> }) {
  return <Link {...props} className={classes(styles.action, className)} data-tone={tone} />;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  level = 1,
  density = "comfortable",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  level?: 1 | 2;
  density?: "comfortable" | "compact";
  className?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className={classes(styles.header, className)} data-density={density}>
      <div className={styles.headingRow}>
        <div className={styles.headingCopy}>
          {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
          <Heading className={level === 1 ? styles.title : styles.sectionTitle} dir="auto">
            {title}
          </Heading>
          {description ? (
            <p className={styles.description} dir="auto">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {children ? <div className={styles.headerContent}>{children}</div> : null}
    </header>
  );
}

export function StatusNotice({
  children,
  tone = "info",
  announce = "off",
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  tone?: StatusTone;
  announce?: "off" | "polite" | "assertive";
  className?: string;
}) {
  return (
    <div
      className={classes(styles.notice, className)}
      data-tone={tone}
      role={announce === "assertive" ? "alert" : announce === "polite" ? "status" : undefined}
    >
      {title ? <strong dir="auto">{title}</strong> : null}
      <div dir="auto">{children}</div>
    </div>
  );
}

export function DataBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span className={styles.badge} data-tone={tone} dir="auto">
      {children}
    </span>
  );
}

export function MetricList({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<{ label: string; value: ReactNode; detail?: string }>;
}) {
  return (
    <dl className={styles.metrics} aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <dt dir="auto">{item.label}</dt>
          <dd dir="auto">
            {item.value}
            {item.detail ? <small>{item.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type FieldCopy = { id: string; label: string; hint?: string; error?: string };
function descriptions(
  id: string,
  hint: string | undefined,
  error: string | undefined,
  extra?: string,
) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null, extra].filter(Boolean).join(" ") ||
    undefined
  );
}
export function TextField({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: ComponentPropsWithoutRef<"input"> & FieldCopy) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <input
        {...props}
        id={id}
        className={classes(styles.input, className)}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={descriptions(id, hint, error, props["aria-describedby"])}
      />
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
export function SelectField({
  id,
  label,
  hint,
  error,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"select"> & FieldCopy) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <select
        {...props}
        id={id}
        className={classes(styles.input, className)}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={descriptions(id, hint, error, props["aria-describedby"])}
      >
        {children}
      </select>
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: ComponentPropsWithoutRef<"textarea"> & FieldCopy) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <textarea
        {...props}
        id={id}
        className={classes(styles.input, className)}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={descriptions(id, hint, error, props["aria-describedby"])}
      />
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function FormSection({
  id,
  legend,
  description,
  layout = "stack",
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"fieldset"> & {
  id: string;
  legend: string;
  description?: string;
  layout?: "stack" | "inline";
}) {
  return (
    <fieldset
      {...props}
      id={id}
      aria-describedby={
        [description ? `${id}-description` : null, props["aria-describedby"]]
          .filter(Boolean)
          .join(" ") || undefined
      }
      className={classes(styles.formSection, className)}
    >
      <legend>{legend}</legend>
      {description ? (
        <p id={`${id}-description`} className={styles.description}>
          {description}
        </p>
      ) : null}
      <div className={styles.sectionFields} data-layout={layout}>
        {children}
      </div>
    </fieldset>
  );
}
