"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useContentI18n } from "@/lib/i18n/content-copy";
import {
  ActionButton,
  FormSection,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { EditorTabs } from "@/components/ui/editor-tabs";
import { VideoMetadataFields } from "@/components/upload/video-metadata-fields";
import {
  contentDraft,
  contentPayload,
  contentVisibility,
  type ContentDraft,
} from "@/lib/content-editor";
import {
  removeStudioVideo,
  unpublishStudioVideo,
  updateStudioVideo,
  type StudioVideo,
} from "@/lib/studio";
import type { ContentTranslationKey } from "@/lib/i18n/content-copy";

import { StudioCaptionManager } from "./studio-caption-manager";
import styles from "./studio-content.module.css";

type ConfirmationIntent = "close" | "unpublish" | "remove" | { href: string };

export function StudioVideoEditor({
  video,
  onClose,
  onCommitted,
}: {
  video: StudioVideo;
  onClose: () => void;
  onCommitted: (message: ContentTranslationKey) => void;
}) {
  const { t, direction } = useContentI18n();
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<ConfirmationIntent | null>(null);
  const confirmationIntent = useRef<ConfirmationIntent | null>(null);
  const [draft, setDraft] = useState(() => contentDraft(video));
  const [baseline] = useState(() => JSON.stringify(contentDraft(video)));
  const [tab, setTab] = useState("details");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [captionBusy, setCaptionBusy] = useState(false);
  const captionPending = useRef(false);
  const [captionDraft, setCaptionDraft] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<ContentTranslationKey | null>(null);
  const mounted = useRef(true);
  const dirty = JSON.stringify(draft) !== baseline;
  const disabled = busy || captionBusy || uncertain || video.status === "REMOVED";
  const heading = useRef<HTMLDivElement>(null);

  const captionActivity = useCallback((value: boolean) => {
    captionPending.current = value;
    setCaptionBusy(value);
  }, []);

  useEffect(() => {
    mounted.current = true;
    heading.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || captionDraft || pending.current || captionPending.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    // Guard ordinary same-tab links without replaying their click handlers or
    // overwriting browser history. Back/forward remains a separate router boundary.
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download"))
        return;
      const destination = new URL(link.href, window.location.href);
      // Cross-origin document departures retain the native beforeunload warning.
      if (destination.origin !== location.origin) return;
      if (
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search
      )
        return;
      if (!pending.current && !captionPending.current && !dirty && !captionDraft) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending.current || captionPending.current || confirmationIntent.current) return;
      const intent = { href: destination.href };
      confirmationIntent.current = intent;
      setConfirmation(intent);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, captionDraft, t]);

  function ask(intent: ConfirmationIntent) {
    if (pending.current || captionPending.current || confirmationIntent.current) return;
    confirmationIntent.current = intent;
    setConfirmation(intent);
  }

  function cancelConfirmation() {
    confirmationIntent.current = null;
    setConfirmation(null);
  }

  function acceptConfirmation() {
    const intent = confirmationIntent.current;
    if (!intent || pending.current || captionPending.current) return;
    confirmationIntent.current = null;
    setConfirmation(null);
    if (intent === "close") onClose();
    else if (typeof intent === "object") {
      const destination = new URL(intent.href);
      router.push(destination.pathname + destination.search + destination.hash);
    } else {
      void commit(intent);
    }
  }

  function close() {
    if (pending.current || captionPending.current) return;
    if (dirty || captionDraft) ask("close");
    else onClose();
  }

  function change(patch: Partial<ContentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  async function commit(kind: "save" | "unpublish" | "remove") {
    if (pending.current || captionPending.current || uncertain || video.status === "REMOVED")
      return;
    let payload: ReturnType<typeof contentPayload> | undefined;
    if (kind === "save") {
      try {
        payload = contentPayload(draft);
      } catch (caught) {
        const titleError = caught instanceof Error && caught.message === "INVALID_TITLE";
        setError(titleError ? "content.titleError" : "content.metadataError");
        setTab(titleError ? "details" : "advanced");
        return;
      }
    } else {
      if (dirty || captionDraft) return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (kind === "save") await updateStudioVideo(video.id, payload!);
      else if (kind === "unpublish") await unpublishStudioVideo(video.id);
      else await removeStudioVideo(video.id);
      if (!mounted.current) return;
      // An acknowledged mutation is not undone by a subsequent failed library GET.
      onCommitted(
        kind === "save"
          ? "content.saved"
          : kind === "remove"
            ? "content.deleted"
            : "content.unpublished",
      );
    } catch {
      // The existing controller applies basic/advanced changes in two stages. Even
      // an HTTP failure may be partial; do not silently replay or claim rollback.
      if (mounted.current) setUncertain(true);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section aria-label={t("content.editor")} className={styles.editor}>
      <div ref={heading} tabIndex={-1} className={styles.editorHeading}>
        <PageHeader
          title={video.title}
          eyebrow={t("content.editor")}
          actions={
            <ActionButton tone="secondary" disabled={busy || captionBusy} onClick={close}>
              {t("content.back")}
            </ActionButton>
          }
        />
      </div>
      {dirty ? <StatusNotice>{t("content.unsaved")}</StatusNotice> : null}
      {uncertain ? (
        <StatusNotice tone="warning" announce="assertive">
          {t("content.uncertain")}
        </StatusNotice>
      ) : null}
      {error ? (
        <StatusNotice tone="danger" announce="assertive">
          {t(error)}
        </StatusNotice>
      ) : null}
      {video.status === "REMOVED" ? <StatusNotice>{t("content.readOnly")}</StatusNotice> : null}
      <EditorTabs
        label={t("content.editor")}
        value={tab}
        onChange={setTab}
        direction={direction}
        tabs={[
          {
            id: "details",
            label: t("content.details"),
            content: (
              <FormSection id="content-basic" legend={t("content.details")} disabled={disabled}>
                <TextField
                  id="content-title"
                  label={t("content.title")}
                  required
                  maxLength={200}
                  value={draft.title}
                  onChange={(event) => change({ title: event.target.value })}
                />
                <TextAreaField
                  id="content-description"
                  label={t("content.description")}
                  maxLength={20_000}
                  rows={6}
                  value={draft.description ?? ""}
                  onChange={(event) => change({ description: event.target.value || null })}
                />
                <SelectField
                  id="content-visibility"
                  label={t("content.visibility")}
                  value={draft.visibility}
                  onChange={(event) =>
                    change({ visibility: event.target.value as ContentDraft["visibility"] })
                  }
                >
                  {Object.entries(contentVisibility).map(([value, key]) => (
                    <option value={value} key={value}>
                      {t(key)}
                    </option>
                  ))}
                </SelectField>
                <div className={styles.toggles}>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.commentsEnabled}
                      onChange={(event) => change({ commentsEnabled: event.target.checked })}
                    />
                    {t("content.comments")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.tvIncluded}
                      onChange={(event) => change({ tvIncluded: event.target.checked })}
                    />
                    {t("content.tv")}
                  </label>
                </div>
              </FormSection>
            ),
          },
          {
            id: "advanced",
            label: t("content.advanced"),
            content: (
              <FormSection
                id="content-advanced"
                legend={t("content.advanced")}
                description={t("content.advancedHint")}
                disabled={disabled}
              >
                <VideoMetadataFields
                  disabled={disabled}
                  showRights={false}
                  value={draft.metadata}
                  onChange={(metadata) => change({ metadata })}
                />
              </FormSection>
            ),
          },
          {
            id: "captions",
            label: t("content.captions"),
            content: (
              <StudioCaptionManager
                videoId={video.id}
                disabled={disabled}
                onBusyChange={captionActivity}
                onDraftChange={setCaptionDraft}
              />
            ),
          },
        ]}
      />
      <div className={styles.actions}>
        <ActionButton
          disabled={disabled || !dirty || captionDraft}
          pending={busy}
          onClick={() => void commit("save")}
        >
          {t(busy ? "content.saving" : "content.save")}
        </ActionButton>
        {video.status === "PUBLISHED" ? (
          <ActionButton
            tone="secondary"
            disabled={disabled || dirty || captionDraft}
            onClick={() => ask("unpublish")}
          >
            {t("content.unpublish")}
          </ActionButton>
        ) : null}
        <ActionButton
          tone="danger"
          disabled={disabled || dirty || captionDraft}
          onClick={() => ask("remove")}
        >
          {t("content.remove")}
        </ActionButton>
      </div>
      {dirty ? <p className={styles.hint}>{t("content.saveFirst")}</p> : null}
      <ConfirmationDialog
        open={confirmation !== null}
        direction={direction}
        busy={busy || captionBusy}
        title={t(
          confirmation === "remove"
            ? "content.remove"
            : confirmation === "unpublish"
              ? "content.unpublish"
              : "content.leaveTitle",
        )}
        description={t(
          confirmation === "remove"
            ? "content.confirmRemove"
            : confirmation === "unpublish"
              ? "content.confirmUnpublish"
              : "content.discard",
          { title: video.title },
        )}
        confirmLabel={t(
          confirmation === "remove"
            ? "content.remove"
            : confirmation === "unpublish"
              ? "content.unpublish"
              : "content.leaveConfirm",
        )}
        cancelLabel={t("content.keepEditing")}
        onConfirm={acceptConfirmation}
        onCancel={cancelConfirmation}
      />
    </section>
  );
}
