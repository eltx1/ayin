"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { MfaEnrollmentSecret, MfaRecoveryCodes } from "@/components/auth/mfa-secrets";
import {
  MfaRequestError,
  parseMfaCodes,
  parseMfaEnrollment,
  parseMfaStatus,
  requestMfa,
  type MfaEnrollment,
  type MfaStatus,
} from "@/lib/account-mfa";
import styles from "@/app/(viewer)/account/account.module.css";
import mfaStyles from "./account-mfa.module.css";

type Flow =
  | { kind: "start" }
  | { kind: "review"; action: "regenerate" | "disable" }
  | { kind: "enrollment"; data: MfaEnrollment }
  | { kind: "codes"; codes: string[] };

export function AccountMfa({ onSessionsChanged }: { onSessionsChanged: () => void }) {
  const { t, href, formatDate } = useI18n();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<MfaStatus | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [changedAccount, setChangedAccount] = useState(false);
  const scopeChanged = useRef(false);
  const account = useRef<string | null>(null);
  const epoch = useRef(0);
  const pending = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const flowHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    flowHeading.current?.focus();
  }, [flow?.kind]);

  const clearSecrets = useCallback(() => {
    epoch.current += 1;
    mutationController.current?.abort();
    pending.current = false;
    setBusy(false);
    setFlow(null);
    setMessage("");
    form.current?.reset();
  }, []);
  const load = useCallback(
    (preserveError = false) => {
      if (scopeChanged.current) return Promise.resolve();
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      return requestMfa("status", controller.signal)
        .then(parseMfaStatus)
        .then((next) => {
          if (controller.signal.aborted || scopeChanged.current) return;
          if (account.current && account.current !== next.accountId) {
            clearSecrets();
            scopeChanged.current = true;
            setChangedAccount(true);
            setSnapshot(null);
            setError(t("account.mfaAccountChanged"));
            return;
          } else if (!preserveError) setError("");
          account.current = next.accountId;
          setSnapshot(next);
          setSignIn(false);
          setFlow((current) => {
            if (!current) return null;
            if ((current.kind === "enrollment" || current.kind === "start") && next.enabled)
              return null;
            if ((current.kind === "review" || current.kind === "codes") && !next.enabled)
              return null;
            if (current.kind === "review" && current.action === "disable" && next.required)
              return null;
            return current;
          });
          if (!next.enabled) setMessage("");
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || scopeChanged.current) return;
          setSnapshot(null);
          if (cause instanceof MfaRequestError && cause.status === 401) {
            clearSecrets();
            setSignIn(true);
            setError(t("account.mfaSessionExpired"));
          } else setError(t("account.mfaLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
            if (mutationController.current?.signal.aborted) {
              pending.current = false;
              setBusy(false);
            }
          }
        });
    },
    [clearSecrets, t],
  );

  useEffect(() => {
    void load();
    const hide = () => {
      clearSecrets();
      readController.current?.abort();
      account.current = null;
      setSnapshot(null);
      setError("");
      setLoading(true);
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Refresh the whole account workspace, including its identity and sessions.
        window.location.reload();
      }
    };
    const focus = () => {
      if (!pending.current && !scopeChanged.current) {
        setLoading(true);
        void load();
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("focus", focus);
    return () => {
      epoch.current += 1;
      readController.current?.abort();
      mutationController.current?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("focus", focus);
    };
  }, [clearSecrets, load]);

  function begin(next: Flow) {
    if (pending.current) return;
    setError("");
    setMessage("");
    setFlow(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flow || flow.kind === "codes" || !snapshot || pending.current || loading) return;
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    const code = String(fields.get("code") ?? "").trim();
    event.currentTarget.reset();
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const revision = epoch.current;
    const expectedAccountId = snapshot.accountId;
    const controller = new AbortController();
    mutationController.current = controller;
    try {
      const path =
        flow.kind === "start"
          ? "enrollment/start-authenticated"
          : flow.kind === "enrollment"
            ? "enrollment/verify-authenticated"
            : flow.action === "regenerate"
              ? "recovery-codes/regenerate"
              : "disable";
      const result = await requestMfa(path, controller.signal, {
        expectedAccountId,
        ...(flow.kind === "enrollment"
          ? { enrollmentToken: flow.data.enrollmentToken, code }
          : flow.kind === "start"
            ? { password }
            : { password, code }),
      });
      if (revision !== epoch.current || controller.signal.aborted) return;
      if (flow.kind === "start") {
        setFlow({ kind: "enrollment", data: parseMfaEnrollment(result, expectedAccountId) });
      } else if (flow.kind === "review" && flow.action === "disable") {
        clearSecrets();
        setSnapshot(null);
        router.push(href("/login"));
        router.refresh();
      } else {
        setFlow({ kind: "codes", codes: parseMfaCodes(result, expectedAccountId) });
        setMessage(
          t(flow.kind === "enrollment" ? "account.mfaEnabledSuccess" : "account.mfaCodesSuccess"),
        );
        if (flow.kind === "enrollment") onSessionsChanged();
        await load();
      }
    } catch (cause) {
      if (revision !== epoch.current || controller.signal.aborted) return;
      if (cause instanceof MfaRequestError && cause.code === "ACCOUNT_CHANGED") {
        clearSecrets();
        scopeChanged.current = true;
        setChangedAccount(true);
        setSnapshot(null);
        setError(t("account.mfaAccountChanged"));
      } else {
        const code = cause instanceof MfaRequestError ? cause.code : undefined;
        const errorKey =
          code === "UNAUTHORIZED"
            ? "account.mfaCheckDetails"
            : code === "MFA_REQUIRED_BY_POLICY"
              ? "account.mfaRequired"
              : code === "MFA_ENROLLMENT_CHANGED"
                ? "account.mfaSetupChanged"
                : code === "RATE_LIMITED"
                  ? "account.mfaRateLimited"
                  : undefined;
        setError(
          errorKey
            ? t(errorKey)
            : cause instanceof MfaRequestError
              ? cause.message
              : t("account.mfaActionError"),
        );
        // Re-read on rejected credentials/policy. Never replay a mutation.
        // A mistyped factor does not discard an otherwise valid enrollment.
        if (cause instanceof MfaRequestError && (cause.status === 401 || cause.status === 409))
          await load(true);
      }
    } finally {
      if (revision === epoch.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  const reviewing = flow?.kind === "review";
  const disabling = reviewing && flow.action === "disable";
  return (
    <section className={styles.securityCard} aria-labelledby="account-mfa-title">
      <div className={styles.securityHeading}>
        <div>
          <h2 id="account-mfa-title" ref={title} tabIndex={-1}>
            {t("account.mfaTitle")}
          </h2>
          <p>{t("account.mfaIntro")}</p>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={loading || busy || changedAccount}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {t("account.mfaRefresh")}
        </button>
      </div>
      {loading ? <p role="status">{t("account.mfaLoading")}</p> : null}
      {error ? (
        <div role="alert" className={styles.error}>
          <p dir="auto">{error}</p>
          {changedAccount ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => window.location.reload()}
            >
              {t("account.mfaReloadAccount")}
            </button>
          ) : signIn ? (
            <Link href={href("/login")}>{t("auth.signIn")}</Link>
          ) : !snapshot ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={loading || busy}
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              {t("account.mfaRetry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className={styles.success}>
          {message}
        </p>
      ) : null}
      {snapshot ? (
        <div className={mfaStyles.status}>
          <strong>{t(snapshot.enabled ? "account.mfaEnabled" : "account.mfaDisabled")}</strong>
          {snapshot.enabled ? (
            <p>{t("account.mfaRemaining", { count: snapshot.recoveryCodesRemaining })}</p>
          ) : null}
          {snapshot.required ? <p>{t("account.mfaRequired")}</p> : null}
        </div>
      ) : null}
      {!flow && snapshot ? (
        <div className={mfaStyles.actions}>
          {!snapshot.enabled ? (
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy || loading}
              onClick={() => begin({ kind: "start" })}
            >
              {t("account.mfaEnable")}
            </button>
          ) : (
            <>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={busy || loading}
                onClick={() => begin({ kind: "review", action: "regenerate" })}
              >
                {t("account.mfaRegenerate")}
              </button>
              {!snapshot.required ? (
                <button
                  className={styles.dangerButton}
                  type="button"
                  disabled={busy || loading}
                  onClick={() => begin({ kind: "review", action: "disable" })}
                >
                  {t("account.mfaDisable")}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {flow?.kind === "codes" ? (
        <MfaRecoveryCodes
          codes={flow.codes}
          onDone={() => {
            setFlow(null);
            title.current?.focus();
          }}
        />
      ) : null}
      {flow && flow.kind !== "codes" ? (
        <form
          ref={form}
          className={mfaStyles.form}
          onSubmit={submit}
          aria-label={t("account.mfaTitle")}
        >
          <h3 ref={flowHeading} tabIndex={-1}>
            {t(
              flow.kind === "enrollment"
                ? "account.mfaConfirmEnrollment"
                : reviewing
                  ? "account.mfaReviewTitle"
                  : "account.mfaEnable",
            )}
          </h3>
          <p>
            {t(
              flow.kind === "enrollment"
                ? "auth.scanQr"
                : disabling
                  ? "account.mfaDisableReview"
                  : reviewing
                    ? "account.mfaRegenerateReview"
                    : "account.mfaStartIntro",
            )}
          </p>
          {flow.kind === "enrollment" ? (
            <>
              <MfaEnrollmentSecret enrollment={flow.data} label={t("account.mfaTitle")} />
              <p>
                {t("account.mfaExpires", {
                  time: formatDate(flow.data.expiresAt, { timeStyle: "short" }),
                })}
              </p>
            </>
          ) : (
            <label>
              <span>{t("account.mfaPassword")}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
              />
            </label>
          )}
          {flow.kind !== "start" ? (
            <label>
              <span>{t("auth.authenticationCode")}</span>
              <input
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                dir="ltr"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                disabled={busy}
              />
            </label>
          ) : null}
          <div className={mfaStyles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => {
                setFlow(null);
                setError("");
                title.current?.focus();
              }}
            >
              {t("account.mfaCancel")}
            </button>
            <button
              type="submit"
              className={disabling ? styles.dangerButton : styles.primaryButton}
              disabled={busy || loading || !snapshot}
            >
              {t(
                busy
                  ? "account.mfaWorking"
                  : flow.kind === "start"
                    ? "account.mfaStart"
                    : flow.kind === "enrollment"
                      ? "auth.enableMfa"
                      : disabling
                        ? "account.mfaConfirmDisable"
                        : "account.mfaConfirmRegenerate",
              )}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
