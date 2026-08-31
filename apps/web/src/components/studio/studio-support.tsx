"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  createSupportTicket,
  getMySupportTickets,
  type SupportTicket,
} from "@/lib/support";

const categories = [
  "GENERAL",
  "ACCOUNT",
  "CONTENT",
  "MONETIZATION",
  "ADVERTISING",
  "TECHNICAL",
  "RIGHTS",
  "OTHER",
] as const;

export function StudioSupport() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState<(typeof categories)[number]>("GENERAL");
  const [priority, setPriority] = useState<SupportTicket["priority"]>("NORMAL");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setTickets((await getMySupportTickets()).items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Support tickets could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit() {
    if (subject.trim().length < 4 || description.trim().length < 10) return;
    setBusy(true);
    setMessage("");
    try {
      await createSupportTicket({
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
      });
      setSubject("");
      setDescription("");
      setPriority("NORMAL");
      setMessage("Support ticket created. AYIN staff can now triage it from Admin Operations.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The support ticket could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Support</h1>
          <p className={styles.muted}>
            Open a traceable support ticket for account, content, monetization, technical or rights
            issues and follow its status here.
          </p>
        </div>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      <section className={styles.card}>
        <h2>Open a ticket</h2>
        <div className={styles.formGrid}>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as SupportTicket["priority"])}
            >
              {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className={styles.fullField}>
            Details
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
        <button
          className={styles.primary}
          disabled={busy || subject.trim().length < 4 || description.trim().length < 10}
          type="button"
          onClick={() => void submit()}
        >
          Create ticket
        </button>
      </section>

      <section className={styles.panel}>
        <h2>My tickets</h2>
        <div className={styles.ticketList}>
          {tickets.map((ticket) => (
            <article className={styles.ticket} key={ticket.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{ticket.subject}</strong>
                  <p className={styles.muted}>
                    {ticket.category} · {ticket.priority} · opened {new Date(ticket.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={styles.statusBadge}>{ticket.status}</span>
              </div>
              <p>{ticket.description}</p>
              {ticket.resolution ? (
                <p>
                  <strong>Resolution:</strong> {ticket.resolution}
                </p>
              ) : null}
            </article>
          ))}
          {!tickets.length ? <p className={styles.muted}>No support tickets yet.</p> : null}
        </div>
      </section>
    </>
  );
}
