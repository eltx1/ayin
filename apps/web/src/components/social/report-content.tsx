"use client";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";
import {
  contentReportInput,
  reportFailureIsUncertain,
  reportReasons,
  submitContentReport,
  type ReportReason,
  type ReportTarget,
} from "./report-contract";
import styles from "./report-content.module.css";

const labels: Record<ReportReason, [string, string]> = {
  COPYRIGHT: ["Copyright", "حقوق النشر"],
  SPAM: ["Spam", "محتوى مزعج"],
  HARASSMENT: ["Harassment", "تحرش أو مضايقة"],
  HATE: ["Hate", "كراهية"],
  SEXUAL_CONTENT: ["Sexual content", "محتوى جنسي"],
  VIOLENCE: ["Violence", "عنف"],
  MISLEADING: ["Misleading content", "محتوى مضلل"],
  OTHER: ["Other concern", "سبب آخر"],
};
export function ReportContentButton({ target }: { target: ReportTarget }) {
  return <ReportContentSession key={JSON.stringify(target)} target={target} />;
}
function ReportContentSession({ target }: { target: ReportTarget }) {
  const { locale, href } = useI18n(),
    ar = locale === "ar";
  const copy = (en: string, arabic: string) => (ar ? arabic : en);
  const panelId = useId();
  const reasonId = `${panelId}-reason`,
    detailsId = `${panelId}-details`;
  const { onBeforeIdentitySuspend, onAudienceInvalidated } = useViewerProduct();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [bound, setBound] = useState(false),
    [reason, setReason] = useState<ReportReason>("OTHER"),
    [details, setDetails] = useState("");
  const [status, setStatus] = useState<
    "idle" | "checking" | "sending" | "sent" | "uncertain" | "error" | "signin"
  >("idle");
  const operation = useRef<AbortController | null>(null),
    pending = useRef(false),
    boundAccountId = useRef<string | null>(null);
  const outcome = useRef<{ accountId: string; status: "sent" | "uncertain" } | null>(null);
  const clearDraft = useCallback(() => {
    if (panel.current) {
      panel.current.hidden = true;
      panel.current.querySelectorAll("textarea").forEach((field) => {
        field.value = "";
        field.defaultValue = "";
      });
    }
    operation.current?.abort();
    boundAccountId.current = null;
    setBound(false);
    setDetails("");
    setReason("OTHER");
    setOpen(false);
    setStatus((current) =>
      pending.current || current === "uncertain"
        ? "uncertain"
        : current === "sent"
          ? "sent"
          : "idle",
    );
  }, []);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") clearDraft();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", clearDraft);
    const stopSuspend = onBeforeIdentitySuspend(clearDraft);
    const stopAudience = onAudienceInvalidated(clearDraft);
    return () => {
      operation.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", clearDraft);
      stopSuspend();
      stopAudience();
    };
  }, [clearDraft, onBeforeIdentitySuspend, onAudienceInvalidated]);
  async function toggle() {
    if (open) {
      setOpen(false);
      setDetails("");
      return;
    }
    setOpen(true);
    if (pending.current) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    boundAccountId.current = null;
    setBound(false);
    setStatus("checking");
    try {
      const actor = await requestAccountScope("/auth/me", "GET", () => null, {
        signal: controller.signal,
        maxResponseBytes: 64 * 1024,
      });
      if (!controller.signal.aborted) {
        boundAccountId.current = actor.accountId;
        setBound(true);
        setStatus(outcome.current?.accountId === actor.accountId ? outcome.current.status : "idle");
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setStatus(error instanceof AccountScopeError && error.status === 401 ? "signin" : "error");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || status === "sent" || status === "uncertain" || !boundAccountId.current)
      return;
    try {
      contentReportInput(target, reason, details);
    } catch {
      setStatus("error");
      return;
    }
    pending.current = true;
    outcome.current = { accountId: boundAccountId.current, status: "uncertain" };
    setStatus("sending");
    const controller = new AbortController();
    operation.current = controller;
    try {
      await submitContentReport(target, reason, details, {
        signal: controller.signal,
        expectedAccountId: boundAccountId.current,
      });
      if (!controller.signal.aborted) {
        setDetails("");
        outcome.current = { accountId: boundAccountId.current!, status: "sent" };
        setStatus("sent");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (!reportFailureIsUncertain(error)) outcome.current = null;
        if (
          error instanceof AccountScopeError &&
          (error.identityUnverified ||
            error.status === 401 ||
            error.code === "ACCOUNT_CHANGED" ||
            error.code === "PROFILE_CHANGED")
        ) {
          const uncertain = reportFailureIsUncertain(error);
          pending.current = false;
          clearDraft();
          if (uncertain) setStatus("uncertain");
          return;
        }
        setStatus(
          reportFailureIsUncertain(error)
            ? "uncertain"
            : error instanceof AccountScopeError && error.status === 401
              ? "signin"
              : "error",
        );
      }
    } finally {
      pending.current = false;
    }
  }
  const locked =
    status === "checking" ||
    status === "sending" ||
    status === "sent" ||
    status === "uncertain" ||
    !bound;
  return (
    <div className={styles.control}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => void toggle()}
        data-tv-focusable="true"
      >
        {copy("Report", "إبلاغ")}
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          data-private-viewer-state
          className={styles.panel}
          role="group"
          aria-label={copy("Report content", "الإبلاغ عن المحتوى")}
        >
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor={reasonId}>{copy("Reason", "السبب")}</label>
            <select
              id={reasonId}
              value={reason}
              disabled={locked}
              onChange={(event) => setReason(event.target.value as ReportReason)}
            >
              {reportReasons.map((value) => (
                <option key={value} value={value}>
                  {labels[value][ar ? 1 : 0]}
                </option>
              ))}
            </select>
            <label htmlFor={detailsId}>{copy("Details (optional)", "تفاصيل (اختياري)")}</label>
            <textarea
              id={detailsId}
              value={details}
              maxLength={4000}
              disabled={locked}
              rows={3}
              onChange={(event) => setDetails(event.target.value)}
            />
            <button type="submit" disabled={locked}>
              {status === "sending"
                ? copy("Sending…", "جارٍ الإرسال…")
                : copy("Send report", "إرسال البلاغ")}
            </button>
          </form>
          {status === "checking" && (
            <span role="status">{copy("Checking your session…", "جارٍ التحقق من الجلسة…")}</span>
          )}
          {status === "sent" && (
            <span role="status">
              {copy(
                "Report received for review. This does not automatically remove the content.",
                "تم استلام البلاغ للمراجعة. هذا لا يزيل المحتوى تلقائيًا.",
              )}
            </span>
          )}
          {status === "uncertain" && (
            <span role="alert">
              {copy(
                "The report may have been received, but confirmation failed. It has not been resent. Contact support if you need help.",
                "قد يكون البلاغ وصل، لكن تعذّر تأكيده. لم نعد إرساله. تواصل مع الدعم للمساعدة.",
              )}
            </span>
          )}
          {status === "error" && (
            <span role="alert">
              {copy(
                "Could not submit this report. Check your session and details before trying again.",
                "تعذّر إرسال البلاغ. تحقق من الجلسة والتفاصيل قبل المحاولة مجددًا.",
              )}
            </span>
          )}
          {status === "signin" && (
            <Link href={href("/login")}>{copy("Sign in to report", "سجّل الدخول للإبلاغ")}</Link>
          )}
          <Link href={href("/support")}>{copy("Safety and support", "السلامة والدعم")}</Link>
        </div>
      )}
    </div>
  );
}
