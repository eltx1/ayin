"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { registerAdminVerification } from "@/lib/admin-reauthentication";

export function AdminReauthentication() {
  const { locale, direction } = useI18n();
  const ar = locale === "ar";
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const request = useRef<AbortController | null>(null);
  const password = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  const open = useCallback(() => {
    if (dialog.current?.open) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setEnabled(null);
    setError("");
    setVerified(false);
    setBusy(false);
    form.current?.reset();
    dialog.current?.showModal();
    void fetch(`${apiBaseUrl}/auth/mfa/status`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        const status = (await response.json()) as { enabled: boolean };
        if (typeof status.enabled !== "boolean")
          throw new Error("Unable to read verification status.");
        if (!controller.signal.aborted) {
          setEnabled(status.enabled);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Unable to load verification.");
      });
  }, []);

  useEffect(() => {
    const unregister = registerAdminVerification(open);
    return () => {
      unregister();
      request.current?.abort();
    };
  }, [open]);

  useEffect(() => {
    if (enabled !== null && !busy && dialog.current?.open) password.current?.focus();
  }, [enabled, busy]);

  function close() {
    request.current?.abort();
    form.current?.reset();
    dialog.current?.close();
    setError("");
    setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || enabled === null) return;
    const values = new FormData(event.currentTarget);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/mfa/step-up`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: values.get("password"),
          ...(enabled ? { code: values.get("code") } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as { steppedUp?: boolean };
      if (result.steppedUp !== true) throw new Error("Verification was not confirmed.");
      if (!controller.signal.aborted) {
        setVerified(true);
        close();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : ar
              ? "تعذر التحقق. حاول مجددًا."
              : "Verification failed. Please try again.",
        );
        form.current?.reset();
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <button className={styles.button} type="button" onClick={open}>
        {ar ? "إعادة التحقق" : "Verify session"}
      </button>
      {verified ? (
        <p role="status" className={styles.notice}>
          {ar
            ? "تم التحقق. راجع الإجراء وأرسله مجددًا."
            : "Session verified. Review and submit your action again."}
        </p>
      ) : null}
      <dialog
        ref={dialog}
        className={styles.verificationDialog}
        dir={direction}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <h2 id={`${id}-title`}>{ar ? "تأكيد هويتك" : "Confirm your identity"}</h2>
        <p id={`${id}-description`}>
          {ar
            ? "تحقق من هويتك قبل إكمال الإجراء الحساس. لن يُعاد تنفيذ الإجراء تلقائيًا."
            : "Verify your identity before completing a sensitive action. The action will not run automatically."}
        </p>
        {enabled === null && !error ? (
          <p role="status">{ar ? "جارٍ تحميل حالة التحقق…" : "Loading verification…"}</p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <form ref={form} onSubmit={(event) => void submit(event)}>
          <label htmlFor={`${id}-password`}>{ar ? "كلمة المرور" : "Password"}</label>
          <input
            ref={password}
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={enabled === null || busy}
          />
          {enabled ? (
            <>
              <label htmlFor={`${id}-code`}>
                {ar ? "رمز تطبيق المصادقة" : "Authenticator code"}
              </label>
              <input
                id={`${id}-code`}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                disabled={busy}
                dir="ltr"
              />
            </>
          ) : null}
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={enabled === null || busy}>
              {busy ? (ar ? "جارٍ التحقق…" : "Verifying…") : ar ? "تحقق" : "Verify"}
            </button>
            <button className={styles.danger} type="button" onClick={close}>
              {ar ? "إلغاء" : "Cancel"}
            </button>
            {enabled === null && error ? (
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  close();
                  open();
                }}
              >
                {ar ? "إعادة المحاولة" : "Retry"}
              </button>
            ) : null}
          </div>
        </form>
      </dialog>
    </>
  );
}
