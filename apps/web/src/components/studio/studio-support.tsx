"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Disclosure } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  FormSection,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import type { TranslationKey } from "@/lib/i18n/translator";
import {
  createSupportTicket,
  getMySupportTickets,
  isUncertainSupportFailure,
  SupportRequestError,
  validateSupportDraft,
  type SupportTicket,
} from "@/lib/support";
import { useRemoteResource } from "@/lib/use-remote-resource";

import styles from "./studio-feedback.module.css";

const categories = {
  GENERAL: "feedback.categoryGeneral",
  ACCOUNT: "feedback.categoryAccount",
  CONTENT: "feedback.categoryContent",
  MONETIZATION: "feedback.categoryMonetization",
  ADVERTISING: "feedback.categoryAdvertising",
  TECHNICAL: "feedback.categoryTechnical",
  RIGHTS: "feedback.categoryRights",
  OTHER: "feedback.categoryOther",
} as const satisfies Record<string, TranslationKey>;
const priorities = {
  LOW: "feedback.priorityLow",
  NORMAL: "feedback.priorityNormal",
  HIGH: "feedback.priorityHigh",
  URGENT: "feedback.priorityUrgent",
} as const satisfies Record<SupportTicket["priority"], TranslationKey>;
const statuses = {
  OPEN: "feedback.statusOpen",
  IN_PROGRESS: "feedback.statusInProgress",
  WAITING: "feedback.statusWaiting",
  RESOLVED: "feedback.statusResolved",
  CLOSED: "feedback.statusClosed",
} as const satisfies Record<SupportTicket["status"], TranslationKey>;

export function StudioSupport() {
  const { t, href, formatDate } = useI18n();
  const { state, reload } = useRemoteResource(getMySupportTickets);
  const [category, setCategory] = useState<keyof typeof categories>("GENERAL");
  const [priority, setPriority] = useState<SupportTicket["priority"]>("NORMAL");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [errors, setErrors] = useState({ subject: false, description: false });
  const [outcome, setOutcome] = useState<"sent" | "error" | "uncertain" | null>(null);
  const needsSignIn =
    state.status === "error" &&
    state.error instanceof SupportRequestError &&
    [401, 403].includes(state.error.status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || needsSignIn) return;
    const invalid = validateSupportDraft(subject, description);
    setErrors(invalid);
    if (invalid.subject || invalid.description) {
      document.getElementById(invalid.subject ? "support-subject" : "support-details")?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setOutcome(null);
    const draft = { category, priority, subject: subject.trim(), description: description.trim() };
    try {
      await createSupportTicket(draft);
      if (!mounted.current) return;
      setSubject("");
      setDescription("");
      setPriority("NORMAL");
      setOutcome("sent");
      // The acknowledged POST and the subsequent GET have independent outcomes.
      // A failed list refresh must not tell the creator to resubmit a sent ticket.
      reload();
    } catch (error) {
      if (mounted.current) setOutcome(isUncertainSupportFailure(error) ? "uncertain" : "error");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("feedback.support")}
        eyebrow={t("studio.brand")}
        description={t("feedback.supportDescription")}
      />
      <div className={styles.supportLayout}>
        <form
          className={styles.supportForm}
          onSubmit={(event) => void submit(event)}
          aria-label={t("feedback.newTicket")}
        >
          <FormSection
            id="support-fields"
            legend={t("feedback.newTicket")}
            description={t("feedback.ticketInstructions")}
            disabled={busy || needsSignIn}
          >
            <SelectField
              id="support-category"
              label={t("feedback.category")}
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              {Object.entries(categories).map(([value, key]) => (
                <option value={value} key={value}>
                  {t(key)}
                </option>
              ))}
            </SelectField>
            <TextField
              id="support-subject"
              label={t("feedback.subject")}
              value={subject}
              required
              minLength={4}
              maxLength={200}
              {...(errors.subject ? { error: t("feedback.subjectError") } : {})}
              onChange={(event) => {
                setSubject(event.target.value);
                setErrors((current) => ({ ...current, subject: false }));
              }}
            />
            <TextAreaField
              id="support-details"
              label={t("feedback.details")}
              value={description}
              required
              minLength={10}
              maxLength={20_000}
              rows={6}
              {...(errors.description ? { error: t("feedback.detailsError") } : {})}
              onChange={(event) => {
                setDescription(event.target.value);
                setErrors((current) => ({ ...current, description: false }));
              }}
            />
            <Disclosure summary={t("feedback.advanced")}>
              <SelectField
                id="support-priority"
                label={t("feedback.priority")}
                value={priority}
                onChange={(event) => setPriority(event.target.value as SupportTicket["priority"])}
              >
                {Object.entries(priorities).map(([value, key]) => (
                  <option value={value} key={value}>
                    {t(key)}
                  </option>
                ))}
              </SelectField>
            </Disclosure>
          </FormSection>
          <ActionButton type="submit" pending={busy} disabled={needsSignIn}>
            {t(busy ? "feedback.sending" : "feedback.send")}
          </ActionButton>
          {outcome ? (
            <StatusNotice
              announce={outcome === "sent" ? "polite" : "assertive"}
              tone={outcome === "sent" ? "success" : outcome === "uncertain" ? "warning" : "danger"}
            >
              {t(
                outcome === "sent"
                  ? "feedback.sent"
                  : outcome === "uncertain"
                    ? "feedback.sendUncertain"
                    : "feedback.sendError",
              )}
            </StatusNotice>
          ) : null}
        </form>
        <section aria-labelledby="my-support-tickets" className={styles.tickets}>
          <div className={styles.sectionHeading}>
            <h2 id="my-support-tickets">{t("feedback.ticketsTitle")}</h2>
            <ActionButton
              tone="secondary"
              disabled={busy}
              pending={state.status === "loading"}
              onClick={reload}
            >
              {t("feedback.refresh")}
            </ActionButton>
          </div>
          <p className={styles.secondary}>{t("feedback.ticketsDescription")}</p>
          {state.status === "loading" ? (
            <StatusNotice announce="polite">{t("feedback.ticketsLoading")}</StatusNotice>
          ) : null}
          {state.status === "error" ? (
            <div className={styles.recovery}>
              <StatusNotice announce="assertive" tone="danger">
                {t("feedback.ticketsError")}
              </StatusNotice>
              <div className={styles.actions}>
                <ActionButton tone="secondary" disabled={busy} onClick={reload}>
                  {t("feedback.retry")}
                </ActionButton>
                {needsSignIn ? (
                  <ActionLink href={href("/login")}>{t("feedback.signIn")}</ActionLink>
                ) : null}
              </div>
            </div>
          ) : null}
          {state.status === "ready" && !state.data.items.length ? (
            <StatusNotice tone="neutral">{t("feedback.ticketsEmpty")}</StatusNotice>
          ) : null}
          {state.status === "ready" && state.data.items.length ? (
            <ul className={styles.ticketList}>
              {state.data.items.map((ticket) => (
                <li key={ticket.id}>
                  <Disclosure
                    summary={
                      <span className={styles.ticketSummary}>
                        <strong dir="auto">{ticket.subject}</strong>
                        <DataBadge tone={ticket.status === "RESOLVED" ? "success" : "neutral"}>
                          {t(statuses[ticket.status] ?? "feedback.other")}
                        </DataBadge>
                        <span className={styles.date}>
                          {t("feedback.updated", { date: formatDate(ticket.updatedAt) })}
                        </span>
                      </span>
                    }
                  >
                    <p className={styles.secondary}>
                      {t(
                        categories[ticket.category as keyof typeof categories] ??
                          "feedback.categoryOther",
                      )}{" "}
                      · {t(priorities[ticket.priority] ?? "feedback.other")}
                    </p>
                    <p dir="auto">{ticket.description}</p>
                    {ticket.resolution ? (
                      <div className={styles.resolution}>
                        <strong>{t("feedback.resolution")}</strong>
                        <p dir="auto">{ticket.resolution}</p>
                      </div>
                    ) : null}
                  </Disclosure>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </>
  );
}
