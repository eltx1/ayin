"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  FormSection,
  PageHeader,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { mediaAssetUrl, type EditableChannelResponse } from "@/lib/channel";
import {
  changeChannelImage,
  ChannelEditorRequestError,
  channelEditorInput,
  getChannelEditorSnapshot,
  saveChannelEditor,
  validateChannelImage,
} from "@/lib/channel-editor";
import styles from "./channel-editor.module.css";

type Draft = { name: string; handle: string; description: string; accentColor: string };
const draftFrom = (data: EditableChannelResponse): Draft => ({
  name: data.channel.name,
  handle: data.channel.handle,
  description: data.channel.description ?? "",
  accentColor: data.appearance.accentColor ?? "#63D1CC",
});
export function ChannelEditor({ embedded = false }: { embedded?: boolean } = {}) {
  const Surface = embedded ? "div" : "main";
  const { locale, href } = useI18n(),
    text = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const [data, setData] = useState<EditableChannelResponse | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(false),
    [authDenied, setAuthDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [notice, setNotice] = useState<"saved" | "image" | "invalid" | "invalidImage" | null>(null);
  const read = useRef<AbortController | null>(null),
    mutation = useRef<AbortController | null>(null),
    mounted = useRef(false),
    owner = useRef<string | null>(null),
    uncertainty = useRef(false),
    dirty = useRef(false),
    authorizedAsset = useRef<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{
    kind: "avatar" | "banner";
    file: File;
  } | null>(null);
  const [knownAsset, setKnownAsset] = useState<string | null>(null);
  const readSnapshot = useCallback(() => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return getChannelEditorSnapshot(controller.signal)
      .then((next) => {
        if (!mounted.current || controller.signal.aborted) return;
        const changedOwner = owner.current !== next.channel.id;
        owner.current = next.channel.id;
        setData(next);
        setReviewed(true);
        if (changedOwner) {
          setDraft(draftFrom(next));
          setPendingImage(null);
          setKnownAsset(null);
          authorizedAsset.current = null;
          setUncertain(false);
          uncertainty.current = false;
          dirty.current = false;
          setNotice(null);
        }
        // A recovery read is a server snapshot; never overwrite a retained local draft.
      })
      .catch((error: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (error instanceof ChannelEditorRequestError && [401, 403].includes(error.status)) {
          setAuthDenied(true);
          setDraft(null);
          setPendingImage(null);
          setKnownAsset(null);
          authorizedAsset.current = null;
          owner.current = null;
          dirty.current = false;
        }
        setReadError(true);
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) {
          read.current = null;
          setLoading(false);
        }
      });
  }, []);
  const refresh = useCallback(() => {
    if (mutation.current) return;
    setData(null);
    setLoading(true);
    setReadError(false);
    setAuthDenied(false);
    setReviewed(false);
    void readSnapshot();
  }, [readSnapshot]);
  useEffect(() => {
    mounted.current = true;
    void readSnapshot();
    const hide = () => {
      read.current?.abort();
      if (mutation.current) {
        uncertainty.current = true;
        setUncertain(true);
        mutation.current.abort();
      }
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        mutation.current = null;
        setBusy(false);
        refresh();
      }
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
  }, [readSnapshot, refresh]);
  useEffect(() => {
    const pending = () =>
      dirty.current || Boolean(mutation.current) || uncertainty.current || Boolean(pendingImage);
    const warn = (event: BeforeUnloadEvent) => {
      if (pending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !pending() ||
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
      if (
        !window.confirm(
          locale === "ar"
            ? "مغادرة محرر القناة؟ ستفقد المسودة المحلية والصورة المختارة."
            : "Leave the channel editor? Your local draft and selected image will be lost.",
        )
      ) {
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
  }, [locale, pendingImage]);
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (mutation.current || read.current || uncertainty.current || !data || readError || authDenied)
      return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setNotice(null);
    setReviewed(false);
    try {
      await operation(controller.signal);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (error instanceof ChannelEditorRequestError && [401, 403].includes(error.status)) {
        setData(null);
        setDraft(null);
        setAuthDenied(true);
        setPendingImage(null);
        owner.current = null;
        dirty.current = false;
      }
      uncertainty.current = true;
      setUncertain(true); // No automatic read or write replay.
    } finally {
      if (mounted.current && !controller.signal.aborted) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!data || !draft) return;
    let input: ReturnType<typeof channelEditorInput>;
    try {
      input = channelEditorInput(draft.name, draft.handle, draft.description, draft.accentColor);
    } catch {
      setNotice("invalid");
      return;
    }
    const channelId = data.channel.id;
    void run(async (signal) => {
      const next = await saveChannelEditor(channelId, input, signal);
      if (signal.aborted || !mounted.current) return;
      setData(next);
      setDraft(draftFrom(next));
      dirty.current = false;
      setNotice("saved");
    });
  }
  function upload() {
    if (!data || !pendingImage) return;
    const channelId = data.channel.id,
      selected = pendingImage;
    void run(async (signal) => {
      const appearance = await changeChannelImage(
        channelId,
        selected.kind,
        selected.file,
        signal,
        (assetId) => {
          authorizedAsset.current = assetId;
          if (mounted.current) setKnownAsset(assetId);
        },
      );
      if (signal.aborted || !mounted.current) return;
      setData((current) =>
        current?.channel.id === channelId ? { ...current, appearance } : current,
      );
      setPendingImage(null);
      setKnownAsset(null);
      authorizedAsset.current = null;
      setNotice("image");
    });
  }
  const blocked =
    busy || loading || readError || authDenied || uncertain || data?.channel.status === "REMOVED";
  const update = (key: keyof Draft, value: string) => {
    if (draft) {
      setDraft({ ...draft, [key]: value });
      dirty.current = true;
    }
  };
  return (
    <Surface className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
      <PageHeader
        title={text("Channel settings", "إعدادات القناة")}
        description={text("Edit your channel identity and appearance.", "عدّل هوية قناتك ومظهرها.")}
        actions={
          <>
            <ActionButton tone="secondary" disabled={busy || loading} onClick={refresh}>
              {text("Refresh channel", "تحديث القناة")}
            </ActionButton>
            {data && (
              <ActionLink href={href(`/c/${data.channel.handle}`)}>
                {text("View channel", "عرض القناة")}
              </ActionLink>
            )}
          </>
        }
      />
      {loading && (
        <StatusNotice announce="polite">
          {text("Loading your channel…", "جارٍ تحميل القناة…")}
        </StatusNotice>
      )}
      {(readError || authDenied) && (
        <StatusNotice announce="assertive" tone="danger">
          {text(
            "Your channel could not be loaded. Your local draft is retained while access remains valid.",
            "تعذر تحميل القناة. تُحتفظ بالمسودة المحلية ما دام الوصول صالحًا.",
          )}{" "}
          <ActionButton disabled={loading || busy} onClick={refresh}>
            {text("Retry reading", "إعادة القراءة")}
          </ActionButton>
          {authDenied && (
            <ActionLink href={href("/login")}>{text("Sign in", "تسجيل الدخول")}</ActionLink>
          )}
        </StatusNotice>
      )}
      {notice && (
        <StatusNotice
          tone={notice === "saved" || notice === "image" ? "success" : "danger"}
          announce="polite"
        >
          {notice === "saved"
            ? text(
                "Channel changes saved. Previous handle links redirect to this channel.",
                "حُفظت تغييرات القناة. توجه روابط المعرّف السابق إلى هذه القناة.",
              )
            : notice === "image"
              ? text("Channel image updated.", "تم تحديث صورة القناة.")
              : notice === "invalidImage"
                ? text(
                    "Choose JPG, PNG or WebP: avatar up to 5 MB, banner up to 10 MB.",
                    "اختر JPG أو PNG أو WebP: حتى ٥ م.ب للصورة الشخصية و١٠ م.ب للغلاف.",
                  )
                : text(
                    "Check the name, handle, description and six-digit accent color.",
                    "راجع الاسم والمعرّف والوصف ولون التمييز المكوّن من ست خانات.",
                  )}
        </StatusNotice>
      )}
      {uncertain && (
        <StatusNotice announce="assertive" tone="warning">
          <p>
            {text(
              "The change may already have been saved. It was not repeated. Read and review the current channel before choosing another action.",
              "ربما حُفظ التغيير بالفعل. لم تتكرر العملية. اقرأ القناة الحالية وراجعها قبل اختيار إجراء آخر.",
            )}
          </p>
          <ActionButton disabled={busy || loading} onClick={refresh}>
            {text("Review current channel", "مراجعة القناة الحالية")}
          </ActionButton>{" "}
          <ActionButton
            disabled={!reviewed || !data || loading || busy}
            onClick={() => {
              uncertainty.current = false;
              setUncertain(false);
            }}
          >
            {text("I have reviewed the result", "راجعت نتيجة العملية")}
          </ActionButton>
        </StatusNotice>
      )}
      {data && (
        <section className={styles.card} aria-labelledby="channel-current">
          <h2 id="channel-current">{text("Current saved identity", "الهوية المحفوظة الحالية")}</h2>
          <p dir="auto">
            {data.channel.name} · @{data.channel.handle}
          </p>
          <p dir="auto">{data.channel.description}</p>
          {knownAsset && (
            <p>
              {data.appearance.avatar?.assetId === knownAsset ||
              data.appearance.banner?.assetId === knownAsset
                ? text("The selected image is now applied.", "الصورة المختارة مطبقة الآن.")
                : text(
                    "The selected image has not been confirmed as applied. Do not assume the upload completed.",
                    "لم يُؤكد تطبيق الصورة المختارة. لا تفترض اكتمال رفعها.",
                  )}
            </p>
          )}
        </section>
      )}
      {draft && (
        <form onSubmit={save}>
          <FormSection id="channel-identity" legend={text("Identity", "الهوية")} disabled={blocked}>
            <TextField
              id="channel-name"
              label={text("Channel name", "اسم القناة")}
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
            <TextField
              id="channel-handle"
              label={text("Handle", "المعرّف")}
              required
              maxLength={80}
              autoCapitalize="none"
              spellCheck={false}
              value={draft.handle}
              hint={text(
                "Letters and numbers, with dots, underscores or hyphens between them.",
                "حروف وأرقام مع نقاط أو شرطات سفلية أو شرطات بينها.",
              )}
              onChange={(e) => update("handle", e.target.value)}
            />
            <TextAreaField
              id="channel-description"
              label={text("About", "نبذة")}
              maxLength={5000}
              rows={6}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
            <TextField
              id="channel-accent"
              label={text("Accent color", "لون التمييز")}
              type="color"
              value={draft.accentColor}
              onChange={(e) => update("accentColor", e.target.value.toUpperCase())}
            />
          </FormSection>
          <div className={styles.actions}>
            <ActionButton
              type="submit"
              disabled={
                blocked || !data || JSON.stringify(draft) === JSON.stringify(draftFrom(data))
              }
            >
              {text(busy ? "Saving…" : "Save channel", busy ? "جارٍ الحفظ…" : "حفظ القناة")}
            </ActionButton>
            <ActionButton
              type="button"
              tone="secondary"
              disabled={blocked || !data}
              onClick={() => {
                if (data) {
                  setDraft(draftFrom(data));
                  dirty.current = false;
                  setNotice(null);
                }
              }}
            >
              {text("Use current saved identity", "استخدام الهوية المحفوظة الحالية")}
            </ActionButton>
          </div>
        </form>
      )}
      {data && (
        <section className={styles.card} aria-labelledby="channel-images">
          <h2 id="channel-images">{text("Channel images", "صور القناة")}</h2>
          <fieldset disabled={blocked} className={styles.imageFields}>
            <legend>{text("Choose an image, then upload it", "اختر صورة ثم ارفعها")}</legend>
            {(["avatar", "banner"] as const).map((kind) => {
              const image = mediaAssetUrl(data.appearance[kind]?.objectKey);
              return (
                <label key={kind} className={styles.assetControl}>
                  <span>
                    {kind === "avatar"
                      ? text("Avatar", "الصورة الشخصية")
                      : text("Banner", "الغلاف")}
                  </span>
                  {image && (
                    <div
                      aria-hidden="true"
                      className={`${styles.assetPreview} ${kind === "avatar" ? styles.avatarPreview : styles.bannerPreview}`}
                      style={{ backgroundImage: `url("${image}")` }}
                    />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      try {
                        validateChannelImage(kind, file);
                        setPendingImage({ kind, file });
                        setNotice(null);
                        setKnownAsset(null);
                        authorizedAsset.current = null;
                      } catch {
                        setNotice("invalidImage");
                      }
                    }}
                  />
                  <small>
                    {text(
                      kind === "avatar"
                        ? "JPG, PNG or WebP, up to 5 MB."
                        : "JPG, PNG or WebP, up to 10 MB.",
                      kind === "avatar"
                        ? "JPG أو PNG أو WebP، حتى ٥ م.ب."
                        : "JPG أو PNG أو WebP، حتى ١٠ م.ب.",
                    )}
                  </small>
                </label>
              );
            })}
          </fieldset>
          {pendingImage && (
            <div className={styles.actions}>
              <p dir="auto">{pendingImage.file.name}</p>
              <ActionButton disabled={blocked} onClick={upload}>
                {text("Upload selected image", "رفع الصورة المختارة")}
              </ActionButton>
              <ActionButton
                tone="secondary"
                disabled={blocked}
                onClick={() => setPendingImage(null)}
              >
                {text("Clear selection", "إلغاء الاختيار")}
              </ActionButton>
            </div>
          )}
        </section>
      )}
      {data && (
        <section className={styles.card} aria-labelledby="channel-defaults">
          <h2 id="channel-defaults">{text("Publishing defaults", "إعدادات النشر الافتراضية")}</h2>
          {data.settings ? (
            <dl className={styles.defaults}>
              <div>
                <dt>{text("Visibility", "الظهور")}</dt>
                <dd>
                  {data.settings.defaultVideoVisibility === "PUBLIC"
                    ? text("Public", "عام")
                    : data.settings.defaultVideoVisibility === "PRIVATE"
                      ? text("Private", "خاص")
                      : text("Unlisted", "غير مدرج")}
                </dd>
              </div>
              <div>
                <dt>{text("Comments", "التعليقات")}</dt>
                <dd>
                  {data.settings.defaultCommentsEnabled
                    ? text("On by default", "مفعلة افتراضيًا")
                    : text("Off by default", "معطلة افتراضيًا")}
                </dd>
              </div>
              <div>
                <dt>{text("Creator TV", "تلفزيون المبدع")}</dt>
                <dd>
                  {data.settings.autoAddPublishedToTv
                    ? text("Auto-add eligible uploads", "إضافة تلقائية للمواد المؤهلة")
                    : text("Manual inclusion", "إضافة يدوية")}
                </dd>
              </div>
              <div>
                <dt>{text("TV auto schedule", "جدولة التلفزيون التلقائية")}</dt>
                <dd>
                  {data.settings.tvAutoScheduleEnabled ? text("On", "مفعلة") : text("Off", "معطلة")}
                </dd>
              </div>
            </dl>
          ) : (
            <p>
              {text("Publishing defaults are unavailable.", "إعدادات النشر الافتراضية غير متاحة.")}
            </p>
          )}
        </section>
      )}
    </Surface>
  );
}
