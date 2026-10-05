"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ActionButton,
  DataBadge,
  FormSection,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { AccountScopeError } from "@/lib/account-scope";
import { captionAr, captionEn } from "@/lib/i18n/resources/studio-captions";
import {
  CaptionUploadStageError,
  finalizeStudioCaptionUpload,
  getStudioCaptions,
  prepareStudioCaptionReplacement,
  prepareStudioCaptionUpload,
  putCaptionFile,
  removeStudioCaption,
  updateStudioCaption,
  validateCaptionFile,
  type CaptionOptions,
  type StudioCaptionTrack,
} from "@/lib/studio-captions";
import styles from "./studio-caption-manager.module.css";

type Copy = keyof typeof captionEn;
type Intent = {
  kind: "addIntent" | "replaceIntent" | "enableIntent" | "defaultIntent" | "removeIntent";
  target: string;
  trackId?: string;
};
function scrubNativeFields(root: HTMLElement | null) {
  root
    ?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    )
    .forEach((field) => {
      if (field instanceof HTMLSelectElement) field.selectedIndex = -1;
      else if (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)) {
        field.checked = false;
        field.defaultChecked = false;
        field.removeAttribute("checked");
      } else {
        field.value = "";
        field.defaultValue = "";
        field.removeAttribute("value");
      }
    });
}
export function StudioCaptionManager({
  videoId,
  videoTitle = videoId,
  disabled,
  onBusyChange,
  onDraftChange,
  onPrivacyChange,
  onRecoveryChange,
}: {
  videoId: string;
  videoTitle?: string;
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDraftChange?: (dirty: boolean) => void;
  onPrivacyChange?: (closed: boolean) => void;
  onRecoveryChange?: (required: boolean) => void;
}) {
  const { locale, direction } = useI18n();
  const copy = locale === "ar" ? captionAr : captionEn;
  const [tracks, setTracks] = useState<StudioCaptionTrack[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [privateGeneration, setPrivateGeneration] = useState(0);
  const [notice, setNotice] = useState<Copy | null>(null);
  const [error, setError] = useState<Copy | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [reviewedRead, setReviewedRead] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [form, setForm] = useState<"add" | { id: string; label: string } | null>(null);
  const [languageCode, setLanguageCode] = useState(locale === "ar" ? "ar" : "en");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<StudioCaptionTrack["kind"]>("SUBTITLES");
  const [makeDefault, setMakeDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState<StudioCaptionTrack | null>(null);
  const body = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false),
    locked = useRef(false),
    concealed = useRef(false),
    mounted = useRef(true);
  const account = useRef<string | undefined>(undefined),
    request = useRef<AbortController | null>(null);
  const operation = useRef<Intent | null>(null),
    epoch = useRef(0);
  const callbacks = useRef({ onBusyChange, onDraftChange, onPrivacyChange, onRecoveryChange });
  useEffect(() => {
    callbacks.current = { onBusyChange, onDraftChange, onPrivacyChange, onRecoveryChange };
  });
  const dirty =
    file !== null ||
    label !== "" ||
    languageCode !== (locale === "ar" ? "ar" : "en") ||
    kind !== "SUBTITLES" ||
    makeDefault;
  useEffect(() => {
    onDraftChange?.(dirty || frozen);
  }, [dirty, frozen, onDraftChange]);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      epoch.current++;
      request.current?.abort();
    };
    const conceal = () => {
      // Hide native inputs and any decision dialog synchronously, before state updates.
      if (body.current) body.current.hidden = true;
      scrubNativeFields(body.current);
      body.current?.querySelectorAll("dialog").forEach((dialog) => {
        dialog.hidden = true;
        dialog.close();
      });
      concealed.current = true;
      if (account.current) callbacks.current.onPrivacyChange?.(true);
      epoch.current++;
      request.current?.abort();
      request.current = null;
      if (operation.current) {
        locked.current = true;
        callbacks.current.onRecoveryChange?.(true);
        setFrozen(true);
        setIntent(operation.current);
      }
      pending.current = false;
      callbacks.current.onBusyChange?.(false);
      setBusy(false);
      setClosed(true);
      setReviewedRead(false);
      setRemoving(null);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
    };
    document.addEventListener("visibilitychange", visibility, true);
    window.addEventListener("pagehide", conceal, true);
    return () => {
      mounted.current = false;
      invalidate();
      callbacks.current.onBusyChange?.(false);
      document.removeEventListener("visibilitychange", visibility, true);
      window.removeEventListener("pagehide", conceal, true);
    };
  }, []);
  function begin() {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    const controller = new AbortController();
    request.current = controller;
    return {
      controller,
      revision: epoch.current,
      scope: {
        expectedAccountId: account.current,
        signal: controller.signal,
      } satisfies CaptionOptions,
    };
  }
  function current(run: NonNullable<ReturnType<typeof begin>>) {
    return mounted.current && run.revision === epoch.current && !run.controller.signal.aborted;
  }
  function finish(run: NonNullable<ReturnType<typeof begin>>) {
    if (!current(run)) return;
    pending.current = false;
    request.current = null;
    setBusy(false);
    onBusyChange?.(false);
  }
  function concealFailure() {
    if (body.current) body.current.hidden = true;
    scrubNativeFields(body.current);
    concealed.current = true;
    onPrivacyChange?.(true);
    setClosed(true);
    setRemoving(null);
    setReviewedRead(false);
  }
  function scopeLost(caught: unknown) {
    return (
      caught instanceof AccountScopeError &&
      (caught.identityUnverified ||
        caught.status === 401 ||
        caught.status === 403 ||
        caught.code === "ACCOUNT_CHANGED" ||
        caught.code === "EXPECTED_ACCOUNT_MISMATCH")
    );
  }
  async function read() {
    const run = begin();
    if (!run) return;
    setError(null);
    try {
      const result = await getStudioCaptions(videoId, run.scope);
      if (!current(run)) return;
      account.current = result.accountId;
      setTracks(result.tracks);
      setLoaded(true);
      if (locked.current) {
        // A lost prepare response may still have created this exact language/kind.
        if (operation.current?.kind === "addIntent" && !operation.current.trackId) {
          const match = result.tracks.find(
            (track) => track.languageCode === languageCode && track.kind === kind,
          );
          if (match) {
            operation.current = { ...operation.current, trackId: match.id };
            setIntent(operation.current);
            setForm({ id: match.id, label: match.label });
          }
        }
        setReviewedRead(true);
      }
      if (concealed.current) setPrivateGeneration((value) => value + 1);
      concealed.current = false;
      onPrivacyChange?.(false);
      setClosed(false);
      if (body.current) body.current.hidden = false;
      if (!locked.current) setNotice(null);
    } catch (caught) {
      if (!current(run)) return;
      setError(concealed.current || scopeLost(caught) ? "accountFailed" : "readFailed");
      if (scopeLost(caught) || account.current) concealFailure();
      if (account.current) {
        locked.current = true;
        setFrozen(true);
        onRecoveryChange?.(true);
        setReviewedRead(false);
      }
    } finally {
      finish(run);
    }
  }
  function clearDraft() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setLabel("");
    setLanguageCode(locale === "ar" ? "ar" : "en");
    setKind("SUBTITLES");
    setMakeDefault(false);
    setForm(null);
  }
  async function mutate(
    next: Intent,
    action: (scope: CaptionOptions) => Promise<unknown>,
    upload = false,
  ) {
    if (
      pending.current ||
      locked.current ||
      concealed.current ||
      disabled ||
      !loaded ||
      !account.current
    )
      return;
    const run = begin();
    if (!run) return;
    operation.current = next;
    setIntent(next);
    setError(null);
    setNotice(null);
    setReviewedRead(false);
    let acknowledged = false;
    try {
      await action(run.scope);
      acknowledged = true;
    } catch (caught) {
      // The transport preserves validated commits when its trailing identity read fails.
      acknowledged = caught instanceof AccountScopeError && caught.acknowledged && !upload;
      if (current(run) && scopeLost(caught)) concealFailure();
      if (current(run) && caught instanceof CaptionUploadStageError) {
        setNotice(caught.stage === "UPLOADED" ? "uploadedUnfinalized" : "preparedUnverified");
        if (caught.trackId && operation.current) {
          operation.current = { ...operation.current, trackId: caught.trackId };
          setIntent(operation.current);
          setForm({ id: caught.trackId, label: operation.current.target });
        }
      }
    }
    if (!current(run)) return;
    if (!acknowledged) {
      locked.current = true;
      onRecoveryChange?.(true);
      setFrozen(true);
      setNotice((current) =>
        current === "preparedUnverified" || current === "uploadedUnfinalized"
          ? current
          : "uncertain",
      );
      finish(run);
      return;
    }
    operation.current = null;
    setIntent(null);
    setNotice("saved");
    if (upload) clearDraft();
    if (!concealed.current) {
      try {
        const result = await getStudioCaptions(videoId, run.scope);
        if (!current(run)) return;
        setTracks(result.tracks);
      } catch {
        if (!current(run)) return;
        locked.current = true;
        onRecoveryChange?.(true);
        setFrozen(true);
        setNotice("savedReadFailed");
        concealFailure();
      }
    } else {
      locked.current = true;
      onRecoveryChange?.(true);
      setFrozen(true);
    }
    finish(run);
  }
  function upload() {
    if (!file || !form) return;
    const invalid = validateCaptionFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    let canonical: string;
    try {
      canonical = Intl.getCanonicalLocales(languageCode.trim())[0]!;
      if (!canonical) throw new Error();
    } catch {
      setError("languageError");
      return;
    }
    setLanguageCode(canonical);
    const target = typeof form === "object" ? form : null;
    void mutate(
      {
        kind: target ? "replaceIntent" : "addIntent",
        target: target?.label ?? (label.trim() || canonical),
        ...(target ? { trackId: target.id } : {}),
      },
      async (scope) => {
        const prepared = target
          ? await prepareStudioCaptionReplacement(videoId, target.id, file, scope)
          : await prepareStudioCaptionUpload(
              videoId,
              {
                fileName: file.name,
                sizeBytes: file.size,
                mimeType: "text/vtt",
                languageCode: canonical,
                label: label.trim() || canonical,
                kind,
                default: makeDefault,
              },
              scope,
            );
        if (!mounted.current || scope.signal?.aborted) return;
        operation.current = { ...operation.current!, trackId: prepared.trackId };
        setIntent(operation.current);
        setForm({ id: prepared.trackId, label: target?.label ?? (label.trim() || canonical) });
        await putCaptionFile(prepared.uploadUrl, file, scope);
        // Only finalization proves the entire upload committed. A prepared upload is not saved.
        try {
          await finalizeStudioCaptionUpload(videoId, prepared.trackId, scope);
        } catch (caught) {
          if (!(caught instanceof AccountScopeError && caught.acknowledged)) {
            if (
              caught instanceof AccountScopeError &&
              caught.identityUnverified &&
              !caught.writeStarted
            )
              throw new CaptionUploadStageError(caught, "UPLOADED", prepared.trackId);
            throw caught;
          }
          concealFailure();
        }
      },
      true,
    );
  }
  const blocked = disabled || busy || frozen || closed || !loaded;
  const missingTarget =
    typeof form === "object" && form !== null && !tracks.some((track) => track.id === form.id);
  return (
    <details
      className={styles.root}
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !pending.current && !concealed.current)
          void read();
      }}
    >
      <summary>
        <strong>{copy.title}</strong> <span className={styles.hint}>{copy.optional}</span>
      </summary>
      {closed ? (
        <div className={styles.content}>
          {notice === "saved" || notice === "savedReadFailed" ? (
            <StatusNotice tone="success" announce="polite">
              {copy.saved}
            </StatusNotice>
          ) : null}
          {notice === "savedReadFailed" ? <p>{copy.savedReadFailed}</p> : null}
          {notice === "preparedUnverified" || notice === "uploadedUnfinalized" ? (
            <StatusNotice tone="warning" announce="polite">
              {copy[notice]}
            </StatusNotice>
          ) : null}
          <StatusNotice tone="warning" announce="assertive">
            {copy.hidden}
          </StatusNotice>
          {error ? <p role="alert">{copy[error]}</p> : null}
          <ActionButton disabled={busy} onClick={() => void read()}>
            {copy.verify}
          </ActionButton>
        </div>
      ) : null}
      {!closed ? (
        <div key={privateGeneration} ref={body} className={styles.content}>
          <p className={styles.hint}>
            {copy.video}: <strong dir="auto">{videoTitle}</strong>
          </p>
          {notice ? (
            <StatusNotice tone={notice === "saved" ? "success" : "warning"} announce="polite">
              {copy[notice]}
            </StatusNotice>
          ) : null}
          {error && !closed ? (
            <StatusNotice tone="danger" announce="assertive">
              {copy[error]}
            </StatusNotice>
          ) : null}
          {intent && frozen ? (
            <p className={styles.hint}>
              {copy.intent}: {copy[intent.kind]} · <bdi>{intent.target}</bdi>
              {file ? (
                <>
                  {" "}
                  · {copy.retainedFile}: <bdi>{file.name}</bdi>
                </>
              ) : null}
            </p>
          ) : null}
          <div className={styles.actions}>
            <ActionButton tone="secondary" disabled={busy || disabled} onClick={() => void read()}>
              {copy[busy ? "loading" : "read"]}
            </ActionButton>
            {!form ? (
              <ActionButton disabled={blocked} onClick={() => setForm("add")}>
                {copy.add}
              </ActionButton>
            ) : null}
          </div>
          {frozen && reviewedRead ? (
            <>
              <p className={styles.hint}>{copy.reviewHint}</p>
              <ActionButton
                tone="secondary"
                disabled={busy || disabled}
                onClick={() => {
                  locked.current = false;
                  onRecoveryChange?.(false);
                  operation.current = null;
                  setFrozen(false);
                  setIntent(null);
                  setReviewedRead(false);
                  setNotice(null);
                  setError(null);
                }}
              >
                {copy.review}
              </ActionButton>
            </>
          ) : null}
          {loaded && !tracks.length && (!frozen || reviewedRead) ? (
            <p className={styles.hint}>{copy.empty}</p>
          ) : null}
          <ul className={styles.tracks} aria-label={copy.title} hidden={frozen && !reviewedRead}>
            {tracks.map((track) => (
              <li className={styles.track} key={track.id}>
                <div>
                  <h3 dir="auto">{track.label}</h3>
                  <p className={styles.hint}>
                    <bdi>{track.languageCode}</bdi> · {copy[track.kind]}
                  </p>
                </div>
                <div className={styles.status}>
                  <DataBadge>{copy[track.status]}</DataBadge>
                  {track.default ? <DataBadge>{copy.default}</DataBadge> : null}
                  {track.replacing ? <DataBadge tone="warning">{copy.replacing}</DataBadge> : null}
                </div>
                <div className={styles.actions}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={track.enabled}
                      disabled={blocked || !!form || track.status !== "READY"}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        void mutate(
                          { kind: "enableIntent", target: track.label, trackId: track.id },
                          (scope) => updateStudioCaption(videoId, track.id, { enabled }, scope),
                        );
                      }}
                    />
                    {copy.enabled}
                  </label>
                  <ActionButton
                    tone="secondary"
                    disabled={blocked || !!form || track.default || track.status !== "READY"}
                    onClick={() =>
                      void mutate(
                        { kind: "defaultIntent", target: track.label, trackId: track.id },
                        (scope) => updateStudioCaption(videoId, track.id, { default: true }, scope),
                      )
                    }
                  >
                    {copy.makeDefault}
                  </ActionButton>
                  <ActionButton
                    tone="secondary"
                    disabled={blocked || !!form}
                    onClick={() => {
                      setForm({
                        id: track.id,
                        label: `${track.label} · ${track.languageCode} · ${copy[track.kind]}`,
                      });
                      setLanguageCode(track.languageCode);
                    }}
                  >
                    {copy.replace}
                  </ActionButton>
                  <ActionButton
                    tone="danger"
                    disabled={blocked || !!form}
                    onClick={() => setRemoving(track)}
                  >
                    {copy.remove}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          {form ? (
            <FormSection
              id={`caption-form-${videoId}`}
              legend={
                typeof form === "object" ? `${copy.replacingTarget}: ${form.label}` : copy.add
              }
              disabled={blocked}
            >
              <div className={styles.form}>
                {missingTarget && !frozen ? (
                  <StatusNotice tone="warning">{copy.targetMissing}</StatusNotice>
                ) : null}
                <label className={styles.file}>
                  {copy[typeof form === "object" ? "replaceFile" : "file"]}
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".vtt,text/vtt"
                    aria-describedby={`caption-file-hint-${videoId}`}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setError(null);
                    }}
                  />
                </label>
                <p id={`caption-file-hint-${videoId}`} className={styles.hint}>
                  {copy.fileHint}
                </p>
                {file ? (
                  <p className={styles.hint}>
                    {copy.retainedFile}: <bdi>{file.name}</bdi>
                  </p>
                ) : null}
                {form === "add" ? (
                  <>
                    <TextField
                      id={`caption-language-${videoId}`}
                      label={copy.language}
                      hint={copy.languageHint}
                      maxLength={35}
                      value={languageCode}
                      onChange={(event) => setLanguageCode(event.target.value)}
                    />
                    <details>
                      <summary>{copy.more}</summary>
                      <div className={styles.form}>
                        <TextField
                          id={`caption-label-${videoId}`}
                          label={copy.label}
                          maxLength={80}
                          value={label}
                          onChange={(event) => setLabel(event.target.value)}
                        />
                        <SelectField
                          id={`caption-kind-${videoId}`}
                          label={copy.kind}
                          value={kind}
                          onChange={(event) =>
                            setKind(event.target.value as StudioCaptionTrack["kind"])
                          }
                        >
                          <option value="SUBTITLES">{copy.SUBTITLES}</option>
                          <option value="CAPTIONS">{copy.CAPTIONS}</option>
                        </SelectField>
                        <label className={styles.check}>
                          <input
                            checked={makeDefault}
                            type="checkbox"
                            onChange={(event) => setMakeDefault(event.target.checked)}
                          />
                          {copy.default}
                        </label>
                      </div>
                    </details>
                  </>
                ) : null}
                <div className={styles.actions}>
                  <ActionButton
                    disabled={blocked || !file || missingTarget}
                    pending={busy}
                    onClick={upload}
                  >
                    {copy[busy ? "working" : typeof form === "object" ? "replaceSubmit" : "upload"]}
                  </ActionButton>
                  <ActionButton tone="quiet" disabled={blocked} onClick={clearDraft}>
                    {copy.discard}
                  </ActionButton>
                </div>
              </div>
            </FormSection>
          ) : null}
          <ConfirmationDialog
            open={removing !== null && !closed}
            title={copy.removeTitle}
            description={copy.removeDescription
              .replace("{track}", removing?.label ?? "")
              .replace("{video}", videoTitle)}
            confirmLabel={copy.remove}
            cancelLabel={copy.cancel}
            direction={direction}
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const track = removing;
              setRemoving(null);
              if (track)
                void mutate(
                  { kind: "removeIntent", target: track.label, trackId: track.id },
                  (scope) => removeStudioCaption(videoId, track.id, scope),
                );
            }}
          />
        </div>
      ) : null}
    </details>
  );
}
