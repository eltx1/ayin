"use client";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ActionButton,
  DataBadge,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { studioCommunityAr, studioCommunityEn } from "@/lib/i18n/resources/studio-community";
import { getStudioContent, type StudioVideo } from "@/lib/studio";
import {
  inspectStudioCommunityImage,
  parseStudioCommunityPost,
  readStudioCommunity,
  StudioCommunityRequestError,
  studioCommunityRequest,
  uploadStudioCommunityImage,
  type StudioCommunityPost,
  type StudioPostType,
} from "@/lib/studio-community";
import styles from "./studio-community.module.css";
type Editor = {
  type: StudioPostType;
  body: string;
  pollOptions: string;
  sharedVideoId: string;
  scheduledPublishAt: string;
  imageFile: File | null;
};
const emptyEditor: Editor = {
  type: "TEXT",
  body: "",
  pollOptions: "",
  sharedVideoId: "",
  scheduledPublishAt: "",
  imageFile: null,
};
function signature(editor: Editor) {
  return JSON.stringify({
    ...editor,
    imageFile: editor.imageFile
      ? [editor.imageFile.name, editor.imageFile.size, editor.imageFile.lastModified]
      : null,
  });
}
function postEditor(post: StudioCommunityPost): Editor {
  const date = post.scheduledPublishAt ? new Date(post.scheduledPublishAt) : null;
  return {
    type: post.type,
    body: post.body ?? "",
    pollOptions: post.pollOptions.map((option) => option.label).join("\n"),
    sharedVideoId: post.sharedVideo?.id ?? "",
    scheduledPublishAt: date
      ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : "",
    imageFile: null,
  };
}
type Feedback =
  | "saved"
  | "published"
  | "removed"
  | "savedRefreshFailed"
  | "uncertain"
  | "partial"
  | "rejected"
  | "validation"
  | "imageInvalid";
type Decision =
  { kind: "edit" | "publish" | "remove"; post: StudioCommunityPost } | { kind: "new" };
export function StudioCommunityManager() {
  const { locale, direction, formatDate } = useI18n();
  const copy = locale === "ar" ? studioCommunityAr : studioCommunityEn;
  const [selectedPost, setSelectedPost] = useState<StudioCommunityPost | null>(null);
  const [posts, setPosts] = useState<StudioCommunityPost[]>([]);
  const [videos, setVideos] = useState<StudioVideo[]>([]);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [baseline, setBaseline] = useState(signature(emptyEditor));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const mounted = useRef(false);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = signature(editor) !== baseline;
  const load = useCallback((nextCursor?: string) => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return Promise.all([
      readStudioCommunity(nextCursor, controller.signal),
      getStudioContent({ status: "PUBLISHED" }, controller.signal),
    ])
      .then(([page, content]) => {
        if (!mounted.current || controller.signal.aborted) return false;
        setPosts((current) =>
          nextCursor
            ? [
                ...current,
                ...page.items.filter(
                  (item) => !current.some((previous) => previous.id === item.id),
                ),
              ]
            : page.items,
        );
        setSelectedPost((current) =>
          current ? (page.items.find((item) => item.id === current.id) ?? current) : null,
        );
        setVideos(content.videos);
        setCursor(page.nextCursor);
        setReadState("ready");
        return true;
      })
      .catch(() => {
        if (mounted.current && !controller.signal.aborted) setReadState("error");
        return false;
      })
      .finally(() => {
        if (read.current === controller) read.current = null;
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      read.current?.abort();
      write.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function refresh(nextCursor?: string) {
    if (write.current || read.current) return;
    setReadState("loading");
    void load(nextCursor).then((ok) => {
      if (ok && !nextCursor) setUncertain(false);
    });
  }
  function selectPost(post: StudioCommunityPost | null) {
    const next = post ? postEditor(post) : emptyEditor;
    setEditor(next);
    setBaseline(signature(next));
    setEditingId(post?.id ?? null);
    setSelectedPost(post);
    setFeedback(null);
    setUncertain(false);
    if (fileInput.current) fileInput.current.value = "";
  }
  function requestEdit(post: StudioCommunityPost | null) {
    if (busy || uncertain || readState !== "ready") return;
    if (dirty) setDecision(post ? { kind: "edit", post } : { kind: "new" });
    else selectPost(post);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (write.current || read.current || readState !== "ready" || uncertain) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setFeedback(null);
    let submitted = false,
      acknowledged = false;
    try {
      const existing = selectedPost;
      const options = editor.pollOptions
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean);
      if (
        ((editor.type === "TEXT" || editor.type === "IMAGE") && !editor.body.trim()) ||
        (editor.type === "POLL" &&
          (options.length < 2 ||
            options.length > 6 ||
            options.some((option) => option.length > 160))) ||
        (editor.type === "VIDEO_SHARE" &&
          !videos.some((video) => video.id === editor.sharedVideoId)) ||
        (editor.scheduledPublishAt &&
          (!Number.isFinite(Date.parse(editor.scheduledPublishAt)) ||
            Date.parse(editor.scheduledPublishAt) <= Date.now()))
      ) {
        setFeedback("validation");
        return;
      }
      let dimensions: { width: number; height: number } | null = null;
      if (editor.type === "IMAGE") {
        if (editor.imageFile) {
          try {
            dimensions = await inspectStudioCommunityImage(editor.imageFile);
          } catch {
            setFeedback("imageInvalid");
            return;
          }
        } else if (existing?.imageAsset?.status !== "VALIDATED") {
          setFeedback("imageInvalid");
          return;
        }
      }
      if (controller.signal.aborted || !mounted.current) return;
      const payload = {
        type: editor.type,
        body: editor.body.trim() || null,
        sharedVideoId: editor.type === "VIDEO_SHARE" ? editor.sharedVideoId : null,
        ...(editor.type === "POLL" ? { pollOptions: options } : {}),
        scheduledPublishAt: editor.scheduledPublishAt
          ? new Date(editor.scheduledPublishAt).toISOString()
          : null,
      };
      submitted = true;
      const post = parseStudioCommunityPost(
        await studioCommunityRequest(
          `/creator/community/posts${editingId ? `/${editingId}` : ""}`,
          {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        ),
      );
      if (controller.signal.aborted || !mounted.current) return;
      if ((editingId && post.id !== editingId) || post.type !== editor.type)
        throw new Error("Invalid post acknowledgment");
      acknowledged = true;
      setEditingId(post.id);
      setSelectedPost(post);
      if (editor.type === "IMAGE" && editor.imageFile && dimensions) {
        await uploadStudioCommunityImage(post.id, editor.imageFile, dimensions, controller.signal);
        setSelectedPost({ ...post, imageAsset: { status: "VALIDATED" } });
      }
      if (controller.signal.aborted || !mounted.current) return;
      const next = postEditor(post);
      setEditor(next);
      setBaseline(signature(next));
      if (fileInput.current) fileInput.current.value = "";
      setFeedback("saved");
      setReadState("loading");
      if (!(await load())) if (mounted.current) setFeedback("savedRefreshFailed");
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (acknowledged) {
        setFeedback("partial");
        setUncertain(true);
      } else if (
        error instanceof StudioCommunityRequestError &&
        error.status < 500 &&
        error.status !== 408
      )
        setFeedback("rejected");
      else {
        setFeedback(submitted ? "uncertain" : "validation");
        setUncertain(submitted);
      }
    } finally {
      if (write.current === controller) write.current = null;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  async function act(post: StudioCommunityPost, action: "publish" | "remove") {
    if (write.current || read.current || readState !== "ready" || uncertain) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await studioCommunityRequest(
        `/creator/community/posts/${post.id}${action === "publish" ? "/publish" : ""}`,
        {
          method: action === "publish" ? "POST" : "DELETE",
          ...(action === "publish" ? { body: "{}" } : {}),
          signal: controller.signal,
        },
      );
      if (action === "publish") {
        const published = parseStudioCommunityPost(result);
        if (published.id !== post.id || published.status !== "PUBLISHED")
          throw new Error("Invalid acknowledgment");
      } else if (
        !result ||
        typeof result !== "object" ||
        !("id" in result) ||
        result.id !== post.id ||
        !("status" in result) ||
        result.status !== "REMOVED"
      )
        throw new Error("Invalid acknowledgment");
      if (!mounted.current || controller.signal.aborted) return;
      if (editingId === post.id) selectPost(null);
      setFeedback(action === "publish" ? "published" : "removed");
      setReadState("loading");
      if (!(await load())) if (mounted.current) setFeedback("savedRefreshFailed");
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      if (
        error instanceof StudioCommunityRequestError &&
        error.status < 500 &&
        error.status !== 408
      )
        setFeedback("rejected");
      else {
        setUncertain(true);
        setFeedback("uncertain");
      }
    } finally {
      if (write.current === controller) write.current = null;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  const disabled = busy || readState !== "ready" || uncertain;
  const errorFeedback =
    feedback &&
    [
      "uncertain",
      "partial",
      "rejected",
      "validation",
      "imageInvalid",
      "savedRefreshFailed",
    ].includes(feedback);
  return (
    <>
      <PageHeader
        title={copy.title}
        eyebrow={copy.studio}
        description={copy.description}
        actions={
          <>
            <ActionButton
              tone="secondary"
              disabled={busy || readState === "loading"}
              onClick={() => refresh()}
            >
              {copy.refresh}
            </ActionButton>
            <ActionButton
              disabled={busy || uncertain || readState !== "ready"}
              onClick={() => requestEdit(null)}
            >
              {copy.newPost}
            </ActionButton>
          </>
        }
      />
      {feedback && (
        <StatusNotice tone={errorFeedback ? "warning" : "success"} announce="polite">
          {copy[feedback]}
        </StatusNotice>
      )}
      {readState === "loading" && <StatusNotice announce="polite">{copy.loading}</StatusNotice>}
      {readState === "error" && (
        <StatusNotice tone="danger" announce="assertive">
          {copy.readError}{" "}
          <ActionButton disabled={busy} onClick={() => refresh()}>
            {copy.retry}
          </ActionButton>
        </StatusNotice>
      )}
      <form className={styles.panel} aria-label={copy.composer} onSubmit={save}>
        {dirty && <p className={styles.muted}>{copy.dirty}</p>}
        <fieldset disabled={disabled} className={styles.fields}>
          <SelectField
            id="community-type"
            label={copy.type}
            value={editor.type}
            disabled={Boolean(editingId)}
            onChange={(event) =>
              setEditor((current) => ({ ...current, type: event.target.value as StudioPostType }))
            }
          >
            {(["TEXT", "IMAGE", "POLL", "VIDEO_SHARE"] as const).map((type) => (
              <option key={type} value={type}>
                {copy[type]}
              </option>
            ))}
          </SelectField>
          <TextField
            id="community-schedule"
            label={copy.schedule}
            type="datetime-local"
            value={editor.scheduledPublishAt}
            onChange={(event) =>
              setEditor((current) => ({ ...current, scheduledPublishAt: event.target.value }))
            }
          />
          <TextAreaField
            id="community-body"
            label={copy.body}
            maxLength={5000}
            value={editor.body}
            onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))}
          />
          {editor.type === "POLL" && (
            <TextAreaField
              id="community-options"
              label={copy.options}
              maxLength={1000}
              value={editor.pollOptions}
              onChange={(event) =>
                setEditor((current) => ({ ...current, pollOptions: event.target.value }))
              }
            />
          )}
          {editor.type === "VIDEO_SHARE" && (
            <SelectField
              id="community-video"
              label={copy.video}
              value={editor.sharedVideoId}
              onChange={(event) =>
                setEditor((current) => ({ ...current, sharedVideoId: event.target.value }))
              }
            >
              <option value="">{copy.chooseVideo}</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </SelectField>
          )}
          {editor.type === "IMAGE" && (
            <div>
              <label htmlFor="community-image">{copy.image}</label>
              <p id="community-image-hint" className={styles.muted}>
                {copy.imageHint}
              </p>
              <input
                ref={fileInput}
                id="community-image"
                aria-describedby="community-image-hint"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    imageFile: event.target.files?.[0] ?? null,
                  }))
                }
              />
            </div>
          )}
        </fieldset>
        <ActionButton type="submit" pending={busy} disabled={disabled}>
          {busy ? copy.saving : editingId ? copy.save : copy.create}
        </ActionButton>
      </form>
      <section aria-label={copy.posts}>
        <PageHeader level={2} title={copy.posts} />
        <div className={styles.list}>
          {posts.map((post) => (
            <article className={styles.panel} key={post.id}>
              <header className={styles.actions}>
                <DataBadge>{copy[post.type]}</DataBadge>
                <DataBadge>{copy[post.status]}</DataBadge>
                {post.imageAsset && (
                  <DataBadge>
                    {post.imageAsset.status === "VALIDATED" ? copy.imageReady : copy.imagePending}
                  </DataBadge>
                )}
              </header>
              {post.scheduledPublishAt && (
                <time dateTime={post.scheduledPublishAt}>
                  {formatDate(post.scheduledPublishAt, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              )}
              {post.body && <p dir="auto">{post.body}</p>}
              {post.sharedVideo && <p dir="auto">{post.sharedVideo.title}</p>}
              {post.pollOptions.length > 0 && (
                <ul>
                  {post.pollOptions.map((option) => (
                    <li key={option.id} dir="auto">
                      {option.label}
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                {post.status !== "PUBLISHED" && (
                  <>
                    <ActionButton
                      tone="secondary"
                      disabled={disabled}
                      onClick={() => requestEdit(post)}
                    >
                      {copy.edit}
                    </ActionButton>
                    <ActionButton
                      disabled={disabled}
                      onClick={() => setDecision({ kind: "publish", post })}
                    >
                      {copy.publish}
                    </ActionButton>
                  </>
                )}
                <ActionButton
                  tone="danger"
                  disabled={disabled}
                  onClick={() => setDecision({ kind: "remove", post })}
                >
                  {copy.remove}
                </ActionButton>
              </div>
            </article>
          ))}
          {readState === "ready" && posts.length === 0 && <StatusNotice>{copy.empty}</StatusNotice>}
        </div>
        {cursor && readState === "ready" && (
          <ActionButton
            tone="secondary"
            disabled={busy || uncertain}
            onClick={() => refresh(cursor)}
          >
            {copy.more}
          </ActionButton>
        )}
      </section>
      <ConfirmationDialog
        open={decision !== null}
        direction={direction}
        busy={busy}
        title={
          decision?.kind === "remove"
            ? copy.removeTitle
            : decision?.kind === "publish"
              ? copy.publishTitle
              : copy.discardTitle
        }
        description={
          decision?.kind === "remove"
            ? `${copy.removeCopy} ${decision.post.body?.slice(0, 120) ?? copy[decision.post.type]} ${dirty && editingId === decision.post.id ? copy.discardCopy : ""}`
            : decision?.kind === "publish"
              ? `${copy.publishCopy} ${decision.post.body?.slice(0, 120) ?? copy[decision.post.type]} ${dirty && editingId === decision.post.id ? copy.discardCopy : ""}`
              : copy.discardCopy
        }
        confirmLabel={
          decision?.kind === "remove"
            ? copy.remove
            : decision?.kind === "publish"
              ? copy.publish
              : copy.confirm
        }
        cancelLabel={copy.cancel}
        onCancel={() => setDecision(null)}
        onConfirm={() => {
          const current = decision;
          setDecision(null);
          if (!current) return;
          if (current.kind === "new") selectPost(null);
          else if (current.kind === "edit") selectPost(current.post);
          else void act(current.post, current.kind);
        }}
      />
    </>
  );
}
