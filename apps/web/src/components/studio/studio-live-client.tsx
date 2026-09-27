"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  createStudioLive,
  getEncoderCredentials,
  getStudioLive,
  setStudioLiveChat,
  StudioLiveRequestError,
  syncStudioLive,
  type EncoderConfiguration,
  type StudioLiveSnapshot,
  type StudioLiveStream,
} from "@/lib/studio-live";
import styles from "@/app/studio/studio.module.css";

const statusLabels: Record<string, [string, string]> = {
  DRAFT: ["Draft", "مسودة"],
  SCHEDULED: ["Scheduled", "مجدول"],
  READY: ["Ready", "جاهز"],
  LIVE: ["Live", "مباشر"],
  ENDED: ["Ended", "انتهى"],
  CANCELLED: ["Cancelled", "ملغى"],
  FAILED: ["Failed", "فشل"],
};

export function StudioLiveClient() {
  const { locale, href, formatDate } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [data, setData] = useState<StudioLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [encoder, setEncoder] = useState<{ title: string; config: EncoderConfiguration } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState<StudioLiveStream | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const read = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const channelId = useRef<string | null>(null);

  const load = useCallback(() => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return getStudioLive(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        if (channelId.current && channelId.current !== next.channel.id) {
          setEncoder(null);
          setTitle("");
          setScheduledStartAt("");
          setFeedback(null);
        }
        channelId.current = next.channel.id;
        setData(next);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof StudioLiveRequestError && [401, 403].includes(error.status)) {
          setEncoder(null);
          setFeedback(null);
          setSignInRequired(error.status === 401);
          channelId.current = null;
          setTitle("");
          setScheduledStartAt("");
        }
        setLoadError(error instanceof Error ? error.message : "Live sessions are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setSignInRequired(false);
    setData(null);
    await load();
  }, [load]);

  useEffect(() => {
    void load();
    const hideCredentials = () => {
      setEncoder(null);
      read.current?.abort();
      mutation.current?.abort();
    };
    const restorePage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      mutation.current = null;
      dialog.current?.close();
      setRotation(null);
      setBusy(false);
      setEncoder(null);
      setFeedback(null);
      void refresh();
    };
    window.addEventListener("pagehide", hideCredentials);
    window.addEventListener("pageshow", restorePage);
    return () => {
      read.current?.abort();
      mutation.current?.abort();
      window.removeEventListener("pagehide", hideCredentials);
      window.removeEventListener("pageshow", restorePage);
    };
  }, [load, refresh]);
  useEffect(() => {
    if (rotation) dialog.current?.showModal();
  }, [rotation]);

  function closeRotation() {
    dialog.current?.close();
    setRotation(null);
  }
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (mutation.current || loading || !data) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setFeedback(null);
    try {
      await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof StudioLiveRequestError && [401, 403].includes(error.status))
        setEncoder(null);
      setFeedback({
        error: true,
        message: text(
          `${error instanceof Error ? error.message : "The request failed."} The result may be uncertain; check the refreshed session list before submitting again.`,
          `تعذر إتمام الطلب: ${error instanceof Error ? error.message : "خطأ في الاتصال"}. قد تكون النتيجة غير مؤكدة؛ راجع القائمة المحدثة قبل إعادة الإرسال.`,
        ),
      });
    } finally {
      if (!controller.signal.aborted) {
        await refresh();
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void run(async (signal) => {
      await createStudioLive(title, scheduledStartAt, signal);
      if (signal.aborted) return;
      setTitle("");
      setScheduledStartAt("");
      setFeedback({ error: false, message: text("Live session created.", "تم إنشاء جلسة البث.") });
    });
  }
  function credentials(stream: StudioLiveStream, rotate: boolean) {
    closeRotation();
    void run(async (signal) => {
      // A submitted rotation can invalidate the old key even if its response is lost.
      setEncoder(null);
      const config = await getEncoderCredentials(stream.id, rotate, signal);
      if (signal.aborted) return;
      setEncoder({ title: stream.title, config });
      setFeedback({
        error: false,
        message: text(
          "Encoder credentials received. Copy them now and keep them private.",
          "تم استلام بيانات المرمّز. انسخها الآن واحتفظ بها بسرية.",
        ),
      });
    });
  }
  function sync(stream: StudioLiveStream) {
    void run(async (signal) => {
      const result = await syncStudioLive(stream.id, signal);
      if (signal.aborted) return;
      setFeedback({
        error: false,
        message:
          result.evidence?.playable === true
            ? text(
                "The provider confirms playable live output.",
                "أكد المزود توفر بث قابل للتشغيل.",
              )
            : text(
                "The provider has not confirmed playable output. AYIN will only show Live after confirmation.",
                "لم يؤكد المزود توفر بث قابل للتشغيل. ستظهر حالة مباشر بعد التأكيد فقط.",
              ),
      });
    });
  }
  function toggleChat(stream: StudioLiveStream) {
    void run(async (signal) => {
      const result = await setStudioLiveChat(stream.id, !stream.chatEnabled, signal);
      if (signal.aborted) return;
      setFeedback({
        error: false,
        message: result.chatEnabled
          ? text("Live chat enabled.", "تم تفعيل دردشة البث.")
          : text("Live chat disabled.", "تم تعطيل دردشة البث."),
      });
    });
  }
  return (
    <section className={styles.liveWorkspace}>
      <div className={styles.actions}>
        <button
          className={styles.secondary}
          type="button"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          {text("Refresh sessions", "تحديث الجلسات")}
        </button>
      </div>
      {loading ? (
        <p role="status">{text("Loading live sessions…", "جارٍ تحميل جلسات البث…")}</p>
      ) : null}
      {loadError ? (
        <div className={styles.error} role="alert">
          <p>{loadError}</p>
          {signInRequired ? (
            <Link href={href("/login")}>{text("Sign in", "تسجيل الدخول")}</Link>
          ) : null}
          <button
            className={styles.secondary}
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            {text("Retry", "إعادة المحاولة")}
          </button>
        </div>
      ) : null}
      {feedback ? (
        <p
          className={feedback.error ? styles.error : styles.notice}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      {encoder ? (
        <aside
          className={styles.card}
          aria-label={text("One-time encoder configuration", "بيانات المرمّز لمرة واحدة")}
        >
          <h2>
            {text("Encoder setup", "إعداد المرمّز")}: {encoder.title}
          </h2>
          <p>
            {text(
              "These credentials are shown only for this response. Copy them before leaving; they are not saved in this browser.",
              "تظهر هذه البيانات لهذه الاستجابة فقط. انسخها قبل المغادرة؛ لا تحفظ في هذا المتصفح.",
            )}
          </p>
          <dl className={styles.liveCredentials}>
            <dt>{text("RTMPS server", "خادم RTMPS")}</dt>
            <dd>
              <code dir="ltr">{encoder.config.rtmps.serverUrl}</code>
            </dd>
            <dt>{text("Stream key — shown once", "مفتاح البث — يظهر مرة واحدة")}</dt>
            <dd>
              <code dir="ltr">{encoder.config.rtmps.streamKey}</code>
            </dd>
            {encoder.config.srt ? (
              <>
                <dt>{text("SRT URL — shown once", "رابط SRT — يظهر مرة واحدة")}</dt>
                <dd>
                  <code dir="ltr">{encoder.config.srt.url}</code>
                </dd>
              </>
            ) : null}
          </dl>
          <button className={styles.secondary} onClick={() => setEncoder(null)}>
            {text("Hide credentials", "إخفاء البيانات")}
          </button>
        </aside>
      ) : null}
      {data ? (
        <>
          <p>
            {data.provider.configured && data.provider.productionEnabled
              ? text(
                  "Encoder setup is available for this channel.",
                  "إعداد المرمّز متاح لهذه القناة.",
                )
              : text(
                  "You can plan sessions now. Encoder setup is unavailable until the live provider is enabled.",
                  "يمكنك التخطيط للجلسات الآن. إعداد المرمّز غير متاح حتى تفعيل مزود البث.",
                )}
          </p>
          <form className={styles.card} onSubmit={create}>
            <h2>{text("New live session", "جلسة بث جديدة")}</h2>
            <fieldset className={styles.liveFields} disabled={busy || loading}>
              <div className={styles.formGrid}>
                <label>
                  {text("Title", "العنوان")}
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  {text("Scheduled start (optional)", "موعد البدء (اختياري)")}
                  <input
                    type="datetime-local"
                    value={scheduledStartAt}
                    onChange={(event) => setScheduledStartAt(event.target.value)}
                  />
                </label>
              </div>
              <p className={styles.muted}>
                {text(
                  "Times use your device time zone. Leave the start empty to create a draft.",
                  "تستخدم الأوقات المنطقة الزمنية لجهازك. اترك الموعد فارغًا لإنشاء مسودة.",
                )}
              </p>
              <button className={styles.primary} type="submit" disabled={!title.trim()}>
                {text("Create live session", "إنشاء جلسة بث")}
              </button>
            </fieldset>
          </form>
          {!data.streams.length ? (
            <p>
              {text(
                "No live sessions yet. Create your first session above.",
                "لا توجد جلسات بث بعد. أنشئ جلستك الأولى أعلاه.",
              )}
            </p>
          ) : null}
          <div className={styles.commentGrid}>
            {data.streams.map((stream) => (
              <article className={styles.card} key={stream.id}>
                <h2>{stream.title}</h2>
                <p>
                  {text("Status", "الحالة")}:{" "}
                  {statusLabels[stream.status]?.[locale === "ar" ? 1 : 0] ?? stream.status}
                </p>
                {stream.scheduledStartAt ? (
                  <p>
                    {formatDate(stream.scheduledStartAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                ) : null}
                <Link href={href(`/live/${encodeURIComponent(stream.slug)}`)}>
                  {text("Open viewer page", "فتح صفحة المشاهد")}
                </Link>
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    disabled={
                      busy ||
                      loading ||
                      !data.provider.configured ||
                      !data.provider.productionEnabled
                    }
                    onClick={() =>
                      stream.providerStreamId ? setRotation(stream) : credentials(stream, false)
                    }
                  >
                    {stream.providerStreamId
                      ? text("Rotate encoder credentials", "تدوير بيانات المرمّز")
                      : text("Set up encoder", "إعداد المرمّز")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={
                      busy || loading || !data.provider.configured || !stream.providerStreamId
                    }
                    onClick={() => sync(stream)}
                  >
                    {text("Check live status", "التحقق من حالة البث")}
                  </button>
                  <button
                    className={styles.secondary}
                    disabled={busy || loading}
                    onClick={() => toggleChat(stream)}
                  >
                    {stream.chatEnabled
                      ? text("Disable live chat", "تعطيل دردشة البث")
                      : text("Enable live chat", "تفعيل دردشة البث")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      <dialog
        ref={dialog}
        className={styles.liveDialog}
        dir={locale === "ar" ? "rtl" : "ltr"}
        aria-labelledby="rotate-live-title"
        aria-describedby="rotate-live-description"
        onCancel={(event) => {
          event.preventDefault();
          closeRotation();
        }}
      >
        <h2 id="rotate-live-title">
          {text("Rotate encoder credentials?", "تدوير بيانات المرمّز؟")}
        </h2>
        <p id="rotate-live-description">
          {text(
            "The current key will be invalidated and an active broadcast may be interrupted. Update your encoder with the new credentials before reconnecting.",
            "سيصبح المفتاح الحالي غير صالح وقد ينقطع البث الجاري. حدّث المرمّز بالبيانات الجديدة قبل إعادة الاتصال.",
          )}
        </p>
        <p>{rotation?.title}</p>
        <div className={styles.actions}>
          <button className={styles.secondary} autoFocus onClick={closeRotation}>
            {text("Cancel", "إلغاء")}
          </button>
          <button
            className={styles.danger}
            disabled={busy || loading || !rotation}
            onClick={() => {
              if (rotation) credentials(rotation, true);
            }}
          >
            {text("Rotate credentials", "تدوير البيانات")}
          </button>
        </div>
      </dialog>
    </section>
  );
}
