"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, readApiError } from "@/lib/api";

import styles from "./admin-settings.module.css";

type SettingValue = boolean | number | string;

interface AdminSetting {
  key: string;
  namespace: string;
  label: string;
  description: string;
  control: "toggle" | "text" | "number" | "select" | "textarea";
  options?: string[];
  unit?: string;
  highImpact: boolean;
  superadminOnly: boolean;
  defaultValue: SettingValue;
  value: SettingValue;
  source: "stored" | "default" | "invalid-stored";
}

interface SettingsSection {
  id: string;
  label: string;
  settings: AdminSetting[];
}

interface SettingsResponse {
  actorRoles: string[];
  sections: SettingsSection[];
}

export function AdminSettingsPanel() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SettingValue>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  async function load() {
    try {
      const response = await fetch(`${apiBaseUrl}/admin/settings`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setDenied(true);
        return;
      }
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      const body = (await response.json()) as SettingsResponse;
      setData(body);
      setDenied(false);
      setDrafts(
        Object.fromEntries(
          body.sections.flatMap((section) =>
            section.settings.map((setting) => [setting.key, setting.value]),
          ),
        ),
      );
    } catch {
      setError("AYIN Admin could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(setting: AdminSetting) {
    const value = drafts[setting.key];
    if (setting.highImpact) {
      const confirmed = window.confirm(
        `${setting.label} is a high-impact platform setting. Save this change?`,
      );
      if (!confirmed) {
        return;
      }
    }

    setSavingKey(setting.key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/settings/${encodeURIComponent(setting.key)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value,
            confirmHighImpact: setting.highImpact || undefined,
            reason: setting.highImpact ? "Changed from AYIN Admin platform settings" : undefined,
          }),
        },
      );
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      setMessage(`${setting.label} saved.`);
      await load();
    } catch {
      setError("The setting could not be saved.");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <main className={styles.shell}>Loading AYIN Admin settings…</main>;
  }

  if (denied) {
    return (
      <main className={styles.shell}>
        <section className={styles.denied}>
          <p className={styles.eyebrow}>AYIN Admin</p>
          <h1>Administrator access required</h1>
          <p>
            This route does not expose platform settings without server-authorized admin access.
          </p>
          <Link href="/">Return to AYIN</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AYIN Admin</p>
          <h1>Platform settings</h1>
          <p className={styles.intro}>
            Operational defaults are validated by the API. Provider credentials and secrets are
            never ordinary settings.
          </p>
        </div>
        <div className={styles.role}>{data?.actorRoles.join(" · ")}</div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}

      <div className={styles.sections}>
        {data?.sections.map((section) => (
          <section className={styles.section} key={section.id}>
            <div className={styles.sectionHeading}>
              <h2>{section.label}</h2>
              <span>{section.settings.length} settings</span>
            </div>

            <div className={styles.settingList}>
              {section.settings.map((setting) => {
                const draft = drafts[setting.key] ?? setting.value;
                return (
                  <article className={styles.setting} key={setting.key}>
                    <div className={styles.copy}>
                      <div className={styles.labelRow}>
                        <h3>{setting.label}</h3>
                        {setting.highImpact ? (
                          <span className={styles.warning}>High impact</span>
                        ) : null}
                        {setting.superadminOnly ? (
                          <span className={styles.locked}>Superadmin</span>
                        ) : null}
                      </div>
                      <p>{setting.description}</p>
                      <small>
                        {setting.namespace}.{setting.key} ·{" "}
                        {setting.source === "stored" ? "Saved value" : "Safe default"}
                      </small>
                    </div>

                    <div className={styles.editor}>
                      {setting.control === "toggle" ? (
                        <label className={styles.toggle}>
                          <input
                            checked={Boolean(draft)}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [setting.key]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <span>{draft ? "Enabled" : "Disabled"}</span>
                        </label>
                      ) : setting.control === "select" ? (
                        <select
                          value={String(draft)}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [setting.key]: event.target.value,
                            }))
                          }
                        >
                          {setting.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : setting.control === "textarea" ? (
                        <textarea
                          rows={3}
                          value={String(draft)}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [setting.key]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        <div className={styles.inputRow}>
                          <input
                            type={setting.control === "number" ? "number" : "text"}
                            value={String(draft)}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [setting.key]:
                                  setting.control === "number"
                                    ? Number(event.target.value)
                                    : event.target.value,
                              }))
                            }
                          />
                          {setting.unit ? <span>{setting.unit}</span> : null}
                        </div>
                      )}

                      <button
                        disabled={savingKey === setting.key}
                        onClick={() => void save(setting)}
                        type="button"
                      >
                        {savingKey === setting.key ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
