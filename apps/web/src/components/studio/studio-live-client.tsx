"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { PageControls } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import {
  createStudioLive,
  getEncoderCredentials,
  getStudioLive,
  liveSessionInput,
  setStudioLiveChat,
  StudioLiveRequestError,
  syncStudioLive,
  type EncoderConfiguration,
  type StudioLiveSnapshot,
  type StudioLiveStream,
} from "@/lib/studio-live";
import styles from "./studio-live.module.css";
const statuses: Record<string, [string, string]> = {
  DRAFT: ["Draft", "مسودة"],
  SCHEDULED: ["Scheduled", "مجدول"],
  READY: ["Ready", "جاهز"],
  LIVE: ["Live", "مباشر"],
  ENDED: ["Ended", "انتهى"],
  CANCELLED: ["Cancelled", "ملغى"],
  FAILED: ["Failed", "فشل"],
};
export function StudioLiveClient() {
  const { locale, href, formatDate, formatNumber, direction } = useI18n();
  const text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [data, setData] = useState<StudioLiveSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false),
    [signInRequired, setSignInRequired] = useState(false);
  const [title, setTitle] = useState(""),
    [start, setStart] = useState("");
  const [encoder, setEncoder] = useState<{ title: string; config: EncoderConfiguration } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<
    "created" | "encoder" | "playable" | "unconfirmed" | "chat" | "invalid" | null
  >(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [rotation, setRotation] = useState<StudioLiveStream | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const read = useRef<AbortController | null>(null),
    mutation = useRef<AbortController | null>(null),
    channel = useRef<string | null>(null),
    mounted = useRef(false),
    uncertainty = useRef(false),
    currentCursors = useRef<string[]>([]);
  const load = useCallback(async (nextCursors: string[] = []) => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    currentCursors.current = nextCursors;
    setCursors(nextCursors);
    setLoading(true);
    setLoadError(false);
    setSignInRequired(false);
    setData(null);
    setReviewed(false);
    try {
      const next = await getStudioLive(controller.signal, nextCursors.at(-1));
      if (controller.signal.aborted || !mounted.current) return;
      if (channel.current && channel.current !== next.channel.id) {
        setEncoder(null);
        setTitle("");
        setStart("");
        setFeedback(null);
        setUncertain(false);
        uncertainty.current = false;
      }
      channel.current = next.channel.id;
      setData(next);
      setReviewed(true);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof StudioLiveRequestError && [401, 403].includes(error.status)) {
        setEncoder(null);
        setFeedback(null);
        setSignInRequired(error.status === 401);
        channel.current = null;
        setTitle("");
        setStart("");
      }
      setLoadError(true);
    } finally {
      if (!controller.signal.aborted && mounted.current) {
        read.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const hide = () => {
      setEncoder(null);
      read.current?.abort();
      if (mutation.current) {
        uncertainty.current = true;
        setUncertain(true);
        mutation.current.abort();
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      mutation.current = null;
      setBusy(false);
      setRotation(null);
      setEncoder(null);
      setFeedback(null);
      void load();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      read.current?.abort();
      mutation.current?.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, [load]);
  useEffect(() => {
    const dirty = () => Boolean(title.trim() || start || mutation.current || uncertainty.current);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === "_blank" ||
        target.hasAttribute("download") ||
        target.href === window.location.href
      )
        return;
      const message =
        locale === "ar"
          ? "مغادرة صفحة البث؟ ستفقد المسودة المحلية. تظل الجلسات المحفوظة متاحة بعد العودة."
          : "Leave Live? Your local draft will be lost. Saved sessions remain available when you return.";
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [title, start, locale]);
  async function run(operation: (signal: AbortSignal) => Promise<void>, resetPage = false) {
    if (mutation.current || read.current || uncertainty.current || !data || loadError) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setFeedback(null);
    setReviewed(false);
    try {
      await operation(controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      await load(resetPage ? [] : currentCursors.current);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof StudioLiveRequestError && [401, 403].includes(error.status))
        setEncoder(null);
      uncertainty.current = true;
      setUncertain(true);
      setReviewed(false);
      // A lost mutation acknowledgement is not reconciled by an automatic read.
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  const refresh = () => {
    if (!mutation.current) void load([]);
  };
  function create(event: FormEvent) {
    event.preventDefault();
    try {
      liveSessionInput(title, start);
    } catch {
      setFeedback("invalid");
      return;
    }
    const owner = data?.channel.id;
    void run(async (signal) => {
      await createStudioLive(title, start, signal, owner);
      if (signal.aborted || !mounted.current) return;
      setTitle("");
      setStart("");
      setFeedback("created");
    }, true);
  }
  function credentials(stream: StudioLiveStream, rotate: boolean) {
    setRotation(null);
    void run(async (signal) => {
      setEncoder(null);
      const config = await getEncoderCredentials(stream.id, rotate, signal);
      if (!signal.aborted && mounted.current) {
        setEncoder({ title: stream.title, config });
        setFeedback("encoder");
      }
    });
  }
  function sync(stream: StudioLiveStream) {
    void run(async (signal) => {
      const result = await syncStudioLive(stream.id, signal);
      if (!signal.aborted && mounted.current)
        setFeedback(result.evidence.playable ? "playable" : "unconfirmed");
    });
  }
  function chat(stream: StudioLiveStream) {
    void run(async (signal) => {
      await setStudioLiveChat(stream.id, !stream.chatEnabled, signal);
      if (!signal.aborted && mounted.current) setFeedback("chat");
    });
  }
  const messages = {
    created: text("Live session created.", "تم إنشاء جلسة البث."),
    encoder: text(
      "Encoder credentials received. Copy them now and keep them private.",
      "تم استلام بيانات المرمّز. انسخها الآن واحتفظ بها بسرية.",
    ),
    playable: text(
      "The provider confirms playable live output.",
      "أكد المزود توفر بث قابل للتشغيل.",
    ),
    unconfirmed: text(
      "The provider has not confirmed playable output. AYIN will only show Live after confirmation.",
      "لم يؤكد المزود توفر بث قابل للتشغيل. ستظهر حالة مباشر بعد التأكيد فقط.",
    ),
    chat: text("Live chat setting saved.", "تم حفظ إعداد دردشة البث."),
    invalid: text(
      "Enter a title and a valid start date and time.",
      "أدخل عنوانًا وموعد بدء صالحًا.",
    ),
  };
  const blocked = busy || loading || uncertain || loadError;
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={text("Live", "البث المباشر")}
        description={text(
          "Plan sessions, set up your encoder and check live status.",
          "خطط لجلساتك وجهّز المرمّز وتابع حالة البث.",
        )}
        actions={
          <ActionButton tone="secondary" disabled={loading || busy} onClick={refresh}>
            {text("Refresh sessions", "تحديث الجلسات")}
          </ActionButton>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {text("Loading live sessions…", "جارٍ تحميل جلسات البث…")}
        </StatusNotice>
      )}
      {loadError && (
        <StatusNotice tone="danger" announce="assertive">
          {text(
            "Live sessions could not be loaded. Retry without repeating the previous action.",
            "تعذر تحميل جلسات البث. أعد القراءة دون تكرار العملية السابقة.",
          )}{" "}
          {signInRequired && (
            <ActionLink href={href("/login")}>{text("Sign in", "تسجيل الدخول")}</ActionLink>
          )}{" "}
          <ActionButton disabled={busy || loading} onClick={refresh}>
            {text("Retry", "إعادة المحاولة")}
          </ActionButton>
        </StatusNotice>
      )}
      {feedback && (
        <StatusNotice tone={feedback === "invalid" ? "danger" : "success"} announce="polite">
          {messages[feedback]}
        </StatusNotice>
      )}
      {uncertain && (
        <StatusNotice tone="danger" announce="assertive">
          <p>
            {text(
              "The result may be uncertain. The action was not repeated. Refresh and review the sessions before deciding what to do next; received credentials may already have changed.",
              "قد تكون النتيجة غير مؤكدة. لم تتكرر العملية. حدّث الجلسات وراجعها قبل اختيار الخطوة التالية؛ ربما تغيرت بيانات البث بالفعل.",
            )}
          </p>
          <ActionButton tone="secondary" disabled={busy || loading} onClick={refresh}>
            {text("Review sessions", "مراجعة الجلسات")}
          </ActionButton>{" "}
          <ActionButton
            disabled={!reviewed || busy || loading || !data}
            onClick={() => {
              uncertainty.current = false;
              setUncertain(false);
            }}
          >
            {text("I have reviewed the result", "راجعت نتيجة العملية")}
          </ActionButton>
        </StatusNotice>
      )}
      {encoder && (
        <aside
          className={styles.panel}
          aria-label={text("One-time encoder configuration", "بيانات المرمّز لمرة واحدة")}
        >
          <h2>
            {text("Encoder setup", "إعداد المرمّز")}: <span dir="auto">{encoder.title}</span>
          </h2>
          <p>
            {text(
              "These credentials are shown only for this response. Copy them before leaving; they are not saved in this browser.",
              "تظهر هذه البيانات لهذه الاستجابة فقط. انسخها قبل المغادرة؛ لا تحفظ في هذا المتصفح.",
            )}
          </p>
          <dl className={styles.credentials}>
            <dt>{text("RTMPS server", "خادم RTMPS")}</dt>
            <dd>
              <code dir="ltr">{encoder.config.rtmps.serverUrl}</code>
            </dd>
            <dt>{text("Stream key — shown once", "مفتاح البث — يظهر مرة واحدة")}</dt>
            <dd>
              <code dir="ltr">{encoder.config.rtmps.streamKey}</code>
            </dd>
            {encoder.config.srt && (
              <>
                <dt>{text("SRT URL — shown once", "رابط SRT — يظهر مرة واحدة")}</dt>
                <dd>
                  <code dir="ltr">{encoder.config.srt.url}</code>
                </dd>
              </>
            )}
          </dl>
          <ActionButton tone="secondary" onClick={() => setEncoder(null)}>
            {text("Hide credentials", "إخفاء البيانات")}
          </ActionButton>
        </aside>
      )}
      {data && (
        <>
          <StatusNotice>
            {data.provider.configured && data.provider.productionEnabled
              ? text(
                  "Encoder setup is available for this channel.",
                  "إعداد المرمّز متاح لهذه القناة.",
                )
              : text(
                  "You can plan sessions now. Encoder setup is unavailable until the live provider is enabled.",
                  "يمكنك التخطيط للجلسات الآن. إعداد المرمّز غير متاح حتى تفعيل مزود البث.",
                )}
          </StatusNotice>
          <form className={styles.panel} onSubmit={create}>
            <h2>{text("New live session", "جلسة بث جديدة")}</h2>
            <fieldset className={styles.fields} disabled={blocked}>
              <TextField
                id="creator-live-title"
                label={text("Title", "العنوان")}
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <TextField
                id="creator-live-start"
                label={text("Scheduled start (optional)", "موعد البدء (اختياري)")}
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
              <p>
                {text(
                  "Times use your device time zone. Leave the start empty to create a draft.",
                  "تستخدم الأوقات المنطقة الزمنية لجهازك. اترك الموعد فارغًا لإنشاء مسودة.",
                )}
              </p>
              <ActionButton type="submit" tone="primary" disabled={!title.trim()}>
                {text("Create live session", "إنشاء جلسة بث")}
              </ActionButton>
            </fieldset>
          </form>
          {!data.streams.length && (
            <StatusNotice>
              {text(
                "No live sessions yet. Create your first session above.",
                "لا توجد جلسات بث بعد. أنشئ جلستك الأولى أعلاه.",
              )}
            </StatusNotice>
          )}
          <div className={styles.streams}>
            {data.streams.map((stream) => (
              <article className={styles.panel} key={stream.id}>
                <h2 dir="auto">{stream.title}</h2>
                <DataBadge>{statuses[stream.status]?.[locale === "ar" ? 1 : 0]}</DataBadge>
                {stream.scheduledStartAt && (
                  <p>
                    {formatDate(stream.scheduledStartAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                )}
                <ActionLink href={href(`/live/${stream.slug}`)}>
                  {text("Open viewer page", "فتح صفحة المشاهد")}
                </ActionLink>
                <div className={styles.actions}>
                  <ActionButton
                    tone="secondary"
                    disabled={
                      blocked || !data.provider.configured || !data.provider.productionEnabled
                    }
                    onClick={() =>
                      stream.providerStreamId ? setRotation(stream) : credentials(stream, false)
                    }
                  >
                    {stream.providerStreamId
                      ? text("Rotate encoder credentials", "تدوير بيانات المرمّز")
                      : text("Set up encoder", "إعداد المرمّز")}
                  </ActionButton>
                  <ActionButton
                    tone="secondary"
                    disabled={blocked || !data.provider.configured || !stream.providerStreamId}
                    onClick={() => sync(stream)}
                  >
                    {text("Check live status", "التحقق من حالة البث")}
                  </ActionButton>
                  <ActionButton tone="secondary" disabled={blocked} onClick={() => chat(stream)}>
                    {stream.chatEnabled
                      ? text("Disable live chat", "تعطيل دردشة البث")
                      : text("Enable live chat", "تفعيل دردشة البث")}
                  </ActionButton>
                </div>
              </article>
            ))}
          </div>
          {(cursors.length > 0 || data.nextCursor) && (
            <PageControls
              label={text("Live sessions", "جلسات البث")}
              summary={`${text("Page", "الصفحة")} ${formatNumber(cursors.length + 1)}`}
              previousLabel={text("Previous", "السابق")}
              nextLabel={text("Next", "التالي")}
              hasPrevious={!busy && !loading && cursors.length > 0}
              hasNext={!busy && !loading && data.nextCursor !== null}
              onPrevious={() => {
                if (!mutation.current && !read.current) void load(cursors.slice(0, -1));
              }}
              onNext={() => {
                if (!mutation.current && !read.current && data.nextCursor)
                  void load([...cursors, data.nextCursor]);
              }}
            />
          )}
        </>
      )}
      <ConfirmationDialog
        open={rotation !== null}
        title={text("Rotate encoder credentials?", "تدوير بيانات المرمّز؟")}
        description={text(
          "The current key will be invalidated and an active broadcast may be interrupted. Update your encoder with the new credentials before reconnecting.",
          "سيصبح المفتاح الحالي غير صالح وقد ينقطع البث الجاري. حدّث المرمّز بالبيانات الجديدة قبل إعادة الاتصال.",
        )}
        confirmLabel={text("Rotate credentials", "تدوير البيانات")}
        cancelLabel={text("Cancel", "إلغاء")}
        direction={direction}
        busy={blocked}
        onCancel={() => setRotation(null)}
        onConfirm={() => {
          if (rotation) credentials(rotation, true);
        }}
      />
    </div>
  );
}
