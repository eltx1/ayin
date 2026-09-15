"use client";

import { useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

type Maturity = "GENERAL" | "TEEN" | "MATURE";
type AgeRestriction = "NONE" | "AGE_13_PLUS" | "AGE_18_PLUS";

type PolicyResponse = {
  videoId: string;
  policy: {
    maturityLevel: Maturity | null;
    ageRestriction: AgeRestriction;
    kidsEligible: boolean;
    allowedTerritories: string[];
    blockedTerritories: string[];
    rightsExpiresAt: string | null;
  };
};

export function AdminKidsClassification() {
  const [videoId, setVideoId] = useState("");
  const [maturityLevel, setMaturityLevel] = useState<Maturity>("GENERAL");
  const [ageRestriction, setAgeRestriction] = useState<AgeRestriction>("NONE");
  const [kidsEligible, setKidsEligible] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPolicy() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/video-policies/${encodeURIComponent(videoId.trim())}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const body = (await response.json()) as PolicyResponse;
      setMaturityLevel(body.policy.maturityLevel ?? "GENERAL");
      setAgeRestriction(body.policy.ageRestriction);
      setKidsEligible(body.policy.kidsEligible);
      setMessage(
        body.policy.maturityLevel
          ? "Current classification loaded."
          : "This video is currently unclassified and therefore excluded from Kids.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load video policy.");
    } finally {
      setBusy(false);
    }
  }

  async function saveClassification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/video-policies/${encodeURIComponent(videoId.trim())}/classification`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maturityLevel, ageRestriction, kidsEligible, reason }),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(
        kidsEligible
          ? "Classification saved. This video is eligible for Kids, subject to normal rights and availability policy."
          : "Classification saved. This video is excluded from Kids.",
      );
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save classification.");
    } finally {
      setBusy(false);
    }
  }

  const contradictory =
    kidsEligible && (maturityLevel !== "GENERAL" || ageRestriction !== "NONE");

  return (
    <div>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Content safety</span>
          <h1>Kids Classification</h1>
          <p className={styles.muted}>
            Kids eligibility is explicit and fail-closed. Unclassified content never enters Kids
            catalog, search, recommendations or TV discovery.
          </p>
        </div>
      </header>

      <section className={styles.card}>
        <h2>Classify a video</h2>
        <p className={styles.muted}>
          Marking a video Kids-eligible requires GENERAL maturity and no age restriction. The change
          is audited and still respects territorial rights and availability.
        </p>

        <form className={styles.formGrid} onSubmit={saveClassification}>
          <label className={styles.fullField}>
            Video UUID
            <input
              autoComplete="off"
              onChange={(event) => setVideoId(event.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
              required
              value={videoId}
            />
          </label>

          <label>
            Maturity
            <select
              onChange={(event) => setMaturityLevel(event.target.value as Maturity)}
              value={maturityLevel}
            >
              <option value="GENERAL">GENERAL</option>
              <option value="TEEN">TEEN</option>
              <option value="MATURE">MATURE</option>
            </select>
          </label>

          <label>
            Age restriction
            <select
              onChange={(event) => setAgeRestriction(event.target.value as AgeRestriction)}
              value={ageRestriction}
            >
              <option value="NONE">NONE</option>
              <option value="AGE_13_PLUS">13+</option>
              <option value="AGE_18_PLUS">18+</option>
            </select>
          </label>

          <label className={`${styles.check} ${styles.fullField}`}>
            <input
              checked={kidsEligible}
              onChange={(event) => setKidsEligible(event.target.checked)}
              type="checkbox"
            />
            Explicitly eligible for AYIN Kids
          </label>

          <label className={styles.fullField}>
            Audit reason
            <textarea
              minLength={5}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this classification was reviewed and approved"
              required
              value={reason}
            />
          </label>

          {contradictory ? (
            <div className={`${styles.error} ${styles.fullField}`}>
              Kids eligibility requires GENERAL maturity with no age restriction.
            </div>
          ) : null}

          <div className={`${styles.actions} ${styles.fullField}`}>
            <button
              className={styles.button}
              disabled={busy || !videoId.trim()}
              onClick={() => void loadPolicy()}
              type="button"
            >
              {busy ? "Working…" : "Load current"}
            </button>
            <button
              className={styles.button}
              disabled={busy || contradictory || !videoId.trim() || reason.trim().length < 5}
              type="submit"
            >
              Save classification
            </button>
          </div>
        </form>

        {message ? <div className={styles.notice}>{message}</div> : null}
        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <h2>Kids product boundaries</h2>
        <p className={styles.muted}>
          Kids inventory is tagged for stricter advertising rules and personalized targeting is not
          permitted by this product contract. Community interactions are disabled on the Kids
          surface. This tooling does not claim legal children&apos;s privacy compliance; dedicated legal
          review remains required.
        </p>
      </section>
    </div>
  );
}
