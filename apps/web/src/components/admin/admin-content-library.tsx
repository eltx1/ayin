"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  SelectField,
  StatusNotice,
  TextAreaField,
  TextField,
} from "@/components/ui/design-system";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import styles from "@/app/admin/admin.module.css";
import {
  type UploadSession,
  type DirectUploadCompletionInput,
  uploadPreparedVideoDirectly,
} from "@/lib/direct-video-upload";
import { parseUploadCompletion } from "@/lib/upload-session";
import { adminObject, adminRows, adminId } from "@/lib/verified-admin-transport";
import {
  type AdminScopeLease,
  type DirectAdminSession,
  sameAdminSessionScope,
} from "@/lib/admin-session-scope";
import {
  canRollbackSeed,
  parseSeedBatch,
  parseSeedChannel,
  parseSeedCreation,
  seedPhase,
  seedRequest,
  seedPost as post,
  SeedRequestError,
  type SeedBatch,
  type SeedChannel,
  type SeedItem,
  type ImportPhase,
} from "@/lib/admin-content-import";
import { useAdminAccess } from "./admin-access";

const blankDraft = (channelId = "") => ({
  channelId,
  sourceLabel: "",
  title: "",
  description: "",
  contentType: "CREATOR_VIDEO",
  visibility: "PUBLIC",
  rightsBasis: "PUBLIC_DOMAIN",
  sourceNotes: "",
});
type Target = {
  batchId: string;
  itemId: string;
  uploadAllowed: boolean;
  transfer: "none" | "uploading" | "uploaded" | "uncertain";
};
type PendingCompletion = {
  actor: DirectAdminSession;
  batchId: string;
  itemId: string;
  assetId: string;
  payload: DirectUploadCompletionInput;
};
type Operation = { controller: AbortController; lease: AdminScopeLease };

export function AdminContentLibrary({ requestedChannelId = "" }: { requestedChannelId?: string }) {
  const { locale, direction } = useI18n(),
    ar = locale === "ar";
  const c = (en: string, arabic: string) => (ar ? arabic : en);
  const access = useAdminAccess();
  const { getScopeLease, subscribeScopeInvalidation, invalidateScope } = access;
  const [draft, setDraft] = useState(() => blankDraft(requestedChannelId));
  const [channels, setChannels] = useState<SeedChannel[]>([]),
    [batches, setBatches] = useState<SeedBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<SeedBatch | null>(null);
  const [target, setTarget] = useState<Target | null>(null),
    targetRef = useRef<Target | null>(null);
  const [unknownCreate, setUnknownCreate] = useState(false);
  const completion = useRef<PendingCompletion | null>(null);
  const [finishAvailable, setFinishAvailable] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<SeedBatch | null>(null);
  const [fresh, setFresh] = useState(false),
    [generation, setGeneration] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    pending = useRef<Operation | null>(null),
    mounted = useRef(false);
  function retain(next: Target | null) {
    if (
      !next ||
      (completion.current &&
        (completion.current.batchId !== next.batchId || completion.current.itemId !== next.itemId))
    ) {
      completion.current = null;
      setFinishAvailable(false);
    }
    targetRef.current = next;
    setTarget(next);
  }
  const current = useCallback(
    (operation: Operation) =>
      mounted.current &&
      pending.current === operation &&
      !operation.controller.signal.aborted &&
      getScopeLease() === operation.lease,
    [getScopeLease],
  );
  const begin = useCallback((): Operation | null => {
    const lease = getScopeLease();
    if (pending.current || !lease) return null;
    const operation = { controller: new AbortController(), lease };
    pending.current = operation;
    setBusy(true);
    setError(null);
    return operation;
  }, [getScopeLease]);
  function finish(operation: Operation) {
    if (pending.current !== operation) return;
    pending.current = null;
    operation.controller.abort();
    if (mounted.current) setBusy(false);
  }
  const conceal = useCallback((destroy: boolean) => {
    if (root.current) {
      root.current.hidden = true;
      root.current.querySelectorAll("dialog").forEach((dialog) => {
        dialog.hidden = true;
        dialog.close();
      });
      root.current
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          "input,textarea,select",
        )
        .forEach((field) => {
          if (field instanceof HTMLSelectElement) {
            for (const option of field.options) {
              option.selected = false;
              option.defaultSelected = false;
            }
            field.selectedIndex = -1;
          } else {
            field.value = "";
            field.defaultValue = "";
            field.removeAttribute("value");
          }
        });
    }
    pending.current?.controller.abort();
    pending.current = null;
    setVisible(false);
    setFresh(false);
    setBusy(false);
    setRollbackTarget(null);
    // A resumed session must read again; it never resumes a write or a file transfer.
    if (targetRef.current?.transfer === "uploading") {
      const next: Target = { ...targetRef.current, transfer: "uncertain", uploadAllowed: false };
      targetRef.current = next;
      setTarget(next);
    }
    if (destroy) {
      targetRef.current = null;
      setTarget(null);
      setDraft(blankDraft());
      setChannels([]);
      setBatches([]);
      setActiveBatch(null);
      setFile(null);
      setUnknownCreate(false);
      completion.current = null;
      setFinishAvailable(false);
      setUncertain([]);
      setProgress(0);
      setMessage(null);
      setError(null);
    }
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeScopeInvalidation((reason) => conceal(reason === "invalidated"));
    return () => {
      mounted.current = false;
      completion.current = null;
      pending.current?.controller.abort();
      pending.current = null;
      unsubscribe();
    };
  }, [subscribeScopeInvalidation, conceal]);

  function fail(cause: unknown, operation: Operation, fallback: string) {
    if (!current(operation)) return;
    if (!(cause instanceof SeedRequestError && cause.verificationRequired)) {
      completion.current = null;
      setFinishAvailable(false);
    }
    if (cause instanceof SeedRequestError && cause.authorityLost) {
      const committed = cause.acknowledged !== null;
      invalidateScope();
      if (committed)
        setMessage(
          c(
            "The action was saved. Verify your Admin session and read current records before continuing.",
            "تم حفظ الإجراء. تحقق من جلسة الإدارة واقرأ السجلات الحالية قبل المتابعة.",
          ),
        );
      return;
    }
    if (
      cause instanceof SeedRequestError &&
      (cause.status === 401 || (cause.status === 403 && !cause.verificationRequired))
    ) {
      invalidateScope();
      return;
    }
    setError(
      cause instanceof SeedRequestError && cause.verificationRequired
        ? c(
            "Verification required. Your original target is retained. After verification, review and explicitly retry the action.",
            "التحقق مطلوب. تم الاحتفاظ بالعنصر الأصلي. بعد التحقق، راجع الإجراء وأعد المحاولة صراحةً.",
          )
        : fallback,
    );
  }
  const initialLoad = useCallback(async () => {
    const operation = begin();
    if (!operation) return;
    setFresh(false);
    try {
      const [channelPayload, batchPayload] = await Promise.all([
        seedRequest(
          "/admin/content-seeding/channels",
          (v) => adminRows(adminObject(v).items, 100, parseSeedChannel),
          operation.lease.session,
          operation.controller.signal,
        ),
        seedRequest(
          "/admin/content-seeding/batches?take=50",
          (v) => adminRows(v, 50, parseSeedBatch),
          operation.lease.session,
          operation.controller.signal,
        ),
      ]);
      if (!current(operation)) return;
      setChannels(channelPayload);
      setBatches(batchPayload);
      const original = targetRef.current;
      const batch = original ? batchPayload.find((value) => value.id === original.batchId) : null;
      if (batch && original) {
        setActiveBatch(batch);
        const item = batch.items.find((value) => value.id === original.itemId);
        if (
          batch.status === "ROLLED_BACK" ||
          !item ||
          ["rolledBack", "failed"].includes(seedPhase(item))
        ) {
          completion.current = null;
          setFinishAvailable(false);
        }
        if (item && ["processing", "ready", "published"].includes(seedPhase(item))) {
          const next: Target = { ...original, uploadAllowed: false, transfer: "uploaded" };
          targetRef.current = next;
          setTarget(next);
          completion.current = null;
          setFinishAvailable(false);
        }
      }
      setVisible(true);
      setFresh(true);
    } catch (cause) {
      if (!current(operation)) return;
      completion.current = null;
      setFinishAvailable(false);
      if (
        cause instanceof SeedRequestError &&
        (cause.authorityLost || cause.status === 401 || cause.status === 403)
      )
        invalidateScope();
      else
        setError(
          locale === "ar"
            ? "تعذرت قراءة المكتبة. أعد المحاولة."
            : "The library could not be read. Try again.",
        );
    } finally {
      finish(operation);
    }
  }, [begin, current, invalidateScope, locale]);
  useEffect(() => {
    if (!access.session || access.loading) return;
    const timer = window.setTimeout(() => void initialLoad(), 0);
    return () => window.clearTimeout(timer);
  }, [access.session, access.loading, initialLoad]);

  async function readBatch(operation: Operation, batchId: string) {
    const batch = await seedRequest(
      `/admin/content-seeding/batches/${encodeURIComponent(batchId)}`,
      parseSeedBatch,
      operation.lease.session,
      operation.controller.signal,
    );
    if (batch.id !== batchId) throw new Error("Mismatched seed batch");
    if (!current(operation)) return null;
    const original = targetRef.current;
    if (!original || original.batchId === batch.id) setActiveBatch(batch);
    if (original?.batchId === batch.id) {
      const item = batch.items.find((value) => value.id === original.itemId);
      if (
        batch.status === "ROLLED_BACK" ||
        !item ||
        ["rolledBack", "failed"].includes(seedPhase(item))
      ) {
        completion.current = null;
        setFinishAvailable(false);
      }
      if (item && ["processing", "ready", "published"].includes(seedPhase(item))) {
        retain({ ...original, uploadAllowed: false, transfer: "uploaded" });
        completion.current = null;
        setFinishAvailable(false);
      }
    }
    setBatches((prior) => [batch, ...prior.filter((value) => value.id !== batch.id)]);
    setFresh(true);
    setUncertain((prior) =>
      prior.filter((id) =>
        id === batch.id
          ? batch.status !== "ROLLED_BACK"
          : !batch.items.some((item) => item.id === id && seedPhase(item) === "published"),
      ),
    );
    return batch;
  }
  async function refreshBatch(batchId: string) {
    const operation = begin();
    if (!operation) return;
    setFresh(false);
    try {
      await readBatch(operation, batchId);
    } catch (cause) {
      fail(
        cause,
        operation,
        c(
          "Current status could not be read. The original batch is retained; refresh it again.",
          "تعذرت قراءة الحالة الحالية. تم الاحتفاظ بالدفعة الأصلية؛ حدّثها مجددًا.",
        ),
      );
    } finally {
      finish(operation);
    }
  }
  async function refreshRecent() {
    if (pending.current) return;
    await initialLoad();
  }
  async function followRead(operation: Operation, batchId: string) {
    try {
      await readBatch(operation, batchId);
    } catch (cause) {
      setFresh(false);
      fail(
        cause,
        operation,
        c(
          "The action was acknowledged, but current status could not be read. Refresh the original batch.",
          "تم تأكيد الإجراء، لكن تعذرت قراءة الحالة الحالية. حدّث الدفعة الأصلية.",
        ),
      );
    }
  }
  async function transfer(operation: Operation, original: Target, source: File) {
    let session: UploadSession;
    try {
      session = await seedRequest(
        `/admin/content-seeding/items/${encodeURIComponent(original.itemId)}/upload-session`,
        (value) => value as UploadSession,
        operation.lease.session,
        operation.controller.signal,
        post({ sizeBytes: source.size, mimeType: "video/mp4" }),
      );
    } catch (cause) {
      if (current(operation))
        retain({
          ...original,
          uploadAllowed:
            cause instanceof SeedRequestError &&
            cause.status >= 400 &&
            cause.status < 500 &&
            !cause.authorityLost,
          transfer:
            cause instanceof SeedRequestError && cause.status >= 400 && cause.status < 500
              ? "none"
              : "uncertain",
        });
      throw cause;
    }
    if (!current(operation)) return;
    retain({ ...original, uploadAllowed: false, transfer: "uploading" });
    try {
      await uploadPreparedVideoDirectly({
        session,
        file: source,
        signal: operation.controller.signal,
        completeUpload: async (payload) => {
          const exact = {
            actor: operation.lease.session,
            batchId: original.batchId,
            itemId: original.itemId,
            assetId: session.assetId,
            payload,
          };
          try {
            return await seedRequest(
              "/media/uploads/sessions/complete",
              (value) => parseUploadCompletion(value, session.assetId),
              operation.lease.session,
              operation.controller.signal,
              post(payload),
            );
          } catch (cause) {
            if (
              current(operation) &&
              cause instanceof SeedRequestError &&
              cause.verificationRequired
            ) {
              completion.current = exact;
              setFinishAvailable(true);
            }
            throw cause;
          }
        },
        onProgress: (value) => {
          if (current(operation)) setProgress(value);
        },
      });
      if (!current(operation)) return;
      retain({ ...original, uploadAllowed: false, transfer: "uploaded" });
      setFile(null);
      setMessage(
        c(
          "Upload acknowledged. Refresh the original item’s status, then review and publish when ready.",
          "تم تأكيد الرفع. حدّث حالة العنصر الأصلي، ثم راجعه وانشره عند الجاهزية.",
        ),
      );
      await followRead(operation, original.batchId);
    } catch (cause) {
      if (!current(operation)) return;
      retain({ ...original, uploadAllowed: false, transfer: "uncertain" });
      if (!(cause instanceof SeedRequestError)) {
        // Resume/part transport errors have no public authority metadata. Conceal
        // synchronously through the coordinator before checking the current actor.
        setError(
          c(
            "Upload outcome is unconfirmed. Verify access, then refresh the original batch.",
            "نتيجة الرفع غير مؤكدة. تحقق من الصلاحية، ثم حدّث الدفعة الأصلية.",
          ),
        );
        access.refresh();
        return;
      }
      throw cause;
    }
  }
  async function finishOriginalUpload() {
    const exact = completion.current,
      original = targetRef.current;
    if (
      !exact ||
      !original ||
      exact.batchId !== original.batchId ||
      exact.itemId !== original.itemId
    )
      return;
    const operation = begin();
    if (!operation) return;
    if (!sameAdminSessionScope(exact.actor, operation.lease.session)) {
      completion.current = null;
      setFinishAvailable(false);
      invalidateScope();
      return;
    }
    // Consume before sending. Only an explicit step-up rejection can restore it.
    completion.current = null;
    setFinishAvailable(false);
    try {
      await seedRequest(
        "/media/uploads/sessions/complete",
        (value) => parseUploadCompletion(value, exact.assetId),
        operation.lease.session,
        operation.controller.signal,
        post(exact.payload),
      );
      if (!current(operation)) return;
      retain({ ...original, uploadAllowed: false, transfer: "uploaded" });
      setFile(null);
      setProgress(100);
      setMessage(
        c(
          "Upload acknowledged. Refresh the original batch, then review and publish when ready.",
          "تم تأكيد الرفع. حدّث الدفعة الأصلية، ثم راجعها وانشرها عند الجاهزية.",
        ),
      );
      await followRead(operation, original.batchId);
    } catch (cause) {
      if (current(operation) && cause instanceof SeedRequestError && cause.verificationRequired) {
        completion.current = exact;
        setFinishAvailable(true);
      }
      fail(
        cause,
        operation,
        c(
          "Upload completion could not be confirmed. Refresh the original batch; completion will not be replayed while its outcome is unknown.",
          "تعذر تأكيد اكتمال الرفع. حدّث الدفعة الأصلية؛ لن يُعاد تأكيد الاكتمال ما دامت النتيجة غير معروفة.",
        ),
      );
    } finally {
      finish(operation);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      targetRef.current ||
      unknownCreate ||
      !file ||
      !channels.some((item) => item.id === draft.channelId)
    )
      return;
    if (file.type && file.type !== "video/mp4") {
      setError(c("Choose an MP4 video file.", "اختر ملف فيديو MP4."));
      return;
    }
    const operation = begin();
    if (!operation) return;
    setMessage(null);
    setProgress(0);
    setFresh(false);
    let created = false;
    try {
      const result = await seedRequest(
        "/admin/content-seeding/batches",
        parseSeedCreation,
        operation.lease.session,
        operation.controller.signal,
        post({
          channelId: draft.channelId,
          sourceLabel: draft.sourceLabel.trim(),
          items: [
            {
              title: draft.title.trim(),
              description: draft.description.trim() || null,
              contentType: draft.contentType,
              visibility: draft.visibility,
              rightsBasis: draft.rightsBasis,
              sourceNotes: draft.sourceNotes.trim(),
            },
          ],
        }),
      );
      if (!current(operation)) return;
      created = true;
      const original: Target = {
        batchId: result.batchId,
        itemId: result.item.id,
        uploadAllowed: true,
        transfer: "none",
      };
      retain(original);
      const channel = channels.find((item) => item.id === draft.channelId)!;
      const batch: SeedBatch = {
        id: result.batchId,
        sourceLabel: draft.sourceLabel.trim(),
        status: "READY",
        createdAt: new Date().toISOString(),
        channel,
        items: [result.item],
      };
      setActiveBatch(batch);
      setBatches((prior) => [batch, ...prior]);
      setMessage(c("The original batch was created.", "تم إنشاء الدفعة الأصلية."));
      await transfer(operation, original, file);
    } catch (cause) {
      if (!current(operation)) return;
      if (
        !created &&
        cause instanceof SeedRequestError &&
        cause.writeStarted &&
        (cause.status === 0 || cause.status >= 500)
      )
        setUnknownCreate(true);
      fail(
        cause,
        operation,
        c(
          "The operation could not be confirmed. Read the original batch or recent batches before taking another action. No upload or confirmation will be replayed.",
          "تعذر تأكيد العملية. اقرأ الدفعة الأصلية أو الدفعات الأخيرة قبل اتخاذ إجراء آخر. لن يُعاد الرفع أو التأكيد تلقائيًا.",
        ),
      );
    } finally {
      finish(operation);
    }
  }
  async function continueUpload() {
    const original = targetRef.current;
    if (
      !original?.uploadAllowed ||
      !file ||
      activeBatch?.id !== original.batchId ||
      activeBatch.status === "ROLLED_BACK" ||
      !activeBatch.items.some((item) => item.id === original.itemId && seedPhase(item) === "draft")
    )
      return;
    const operation = begin();
    if (!operation) return;
    try {
      await transfer(operation, original, file);
    } catch (cause) {
      fail(
        cause,
        operation,
        c(
          "The upload could not be confirmed. Refresh the original batch before continuing.",
          "تعذر تأكيد الرفع. حدّث الدفعة الأصلية قبل المتابعة.",
        ),
      );
    } finally {
      finish(operation);
    }
  }
  async function mutate(batch: SeedBatch, item?: SeedItem) {
    const key = item?.id ?? batch.id;
    if (
      uncertain.includes(key) ||
      !fresh ||
      (item ? seedPhase(item) !== "ready" : !canRollbackSeed(batch))
    )
      return;
    const operation = begin();
    if (!operation) return;
    setRollbackTarget(null);
    setFresh(false);
    try {
      const latest = await readBatch(operation, batch.id);
      if (!latest || !current(operation)) return;
      const currentItem = item ? latest.items.find((value) => value.id === item.id) : null;
      if (item ? !currentItem || seedPhase(currentItem) !== "ready" : !canRollbackSeed(latest)) {
        setError(
          c("The batch changed. Review its current status.", "تغيّرت الدفعة. راجع حالتها الحالية."),
        );
        return;
      }
      await seedRequest(
        item
          ? `/admin/content-seeding/items/${encodeURIComponent(item.id)}/publish`
          : `/admin/content-seeding/batches/${encodeURIComponent(batch.id)}/rollback`,
        (v) => {
          const r = adminObject(v);
          if (item) {
            if (adminId(r.id) !== item.video.id || r.status !== "PUBLISHED")
              throw new Error("Invalid publication acknowledgment");
          } else if (adminId(r.batchId) !== batch.id || r.status !== "ROLLED_BACK")
            throw new Error("Invalid rollback acknowledgment");
          return r;
        },
        operation.lease.session,
        operation.controller.signal,
        post(),
      );
      if (!current(operation)) return;
      setMessage(
        item
          ? c("Publication was acknowledged for the original item.", "تم تأكيد نشر العنصر الأصلي.")
          : c(
              "Rollback was acknowledged for the original batch.",
              "تم تأكيد التراجع عن الدفعة الأصلية.",
            ),
      );
      if (!item) {
        if (completion.current?.batchId === batch.id) {
          completion.current = null;
          setFinishAvailable(false);
        }
        if (targetRef.current?.batchId === batch.id) {
          retain({ ...targetRef.current, uploadAllowed: false });
          setFile(null);
        }
      }
      // Preserve a committed result separately from any subsequent read failure.
      const committed: SeedBatch = item
        ? {
            ...latest,
            items: latest.items.map((value) =>
              value.id === item.id
                ? { ...value, status: "PUBLISHED", video: { ...value.video, status: "PUBLISHED" } }
                : value,
            ),
          }
        : {
            ...latest,
            status: "ROLLED_BACK",
            items: latest.items.map((value) => ({ ...value, status: "ROLLED_BACK" })),
          };
      if (!targetRef.current || targetRef.current.batchId === committed.id)
        setActiveBatch(committed);
      setBatches((prior) => prior.map((value) => (value.id === committed.id ? committed : value)));
      await followRead(operation, batch.id);
    } catch (cause) {
      if (!current(operation)) return;
      if (
        cause instanceof SeedRequestError &&
        cause.writeStarted &&
        (cause.status === 0 || cause.status >= 500)
      )
        setUncertain((prior) => [...new Set([...prior, key])]);
      fail(
        cause,
        operation,
        c(
          "The action could not be confirmed. Refresh this original batch; do not repeat the action while its outcome is unknown.",
          "تعذر تأكيد الإجراء. حدّث هذه الدفعة الأصلية؛ لا تكرر الإجراء ما دامت نتيجته غير معروفة.",
        ),
      );
    } finally {
      finish(operation);
    }
  }
  const labels: Record<ImportPhase, string> = {
    draft: c("Awaiting upload", "بانتظار الرفع"),
    uploading: c("Upload not yet confirmed", "لم يُؤكد الرفع بعد"),
    processing: c("Processing", "قيد المعالجة"),
    ready: c("Ready to publish", "جاهز للنشر"),
    published: c("Published", "منشور"),
    failed: c("Processing failed", "فشلت المعالجة"),
    rolledBack: c("Rolled back", "تم التراجع"),
  };
  const active = activeBatch?.items.find((item) => item.id === target?.itemId);
  const locked = busy || !fresh;
  const authorized = typeof window !== "undefined" && getScopeLease() !== null;
  return (
    <>
      <PageHeader
        eyebrow={c("Content Operations", "عمليات المحتوى")}
        title={c("AYIN Content Library", "مكتبة محتوى AYIN")}
        description={c(
          "Import rights-cleared content, follow processing, then review and publish.",
          "استورد محتوى موثّق الحقوق، وتابع معالجته، ثم راجعه وانشره.",
        )}
      />
      {!visible || !authorized ? (
        <StatusNotice>
          {c(
            "Verify Admin access and read the library to continue.",
            "تحقق من صلاحية الإدارة واقرأ المكتبة للمتابعة.",
          )}{" "}
          <ActionButton
            disabled={busy || access.loading}
            onClick={() => {
              if (getScopeLease()) void initialLoad();
              else access.refresh();
            }}
          >
            {c("Read library", "قراءة المكتبة")}
          </ActionButton>
        </StatusNotice>
      ) : null}
      {message ? (
        <StatusNotice announce="polite" tone="success">
          {message}
        </StatusNotice>
      ) : null}
      {error ? (
        <StatusNotice announce="assertive" tone="warning">
          {error}
        </StatusNotice>
      ) : null}
      {visible && authorized ? (
        <div ref={root} key={generation} data-import-private dir={direction}>
          <section className={styles.card} style={{ marginBottom: "16px" }}>
            <h2>{c("Rights gate", "التحقق من الحقوق")}</h2>
            <p>
              {c(
                "Online availability is not permission. Keep the source, license, authorization or ownership evidence for every item.",
                "التوفر على الإنترنت لا يعني الإذن. احتفظ بالمصدر والترخيص أو التفويض أو إثبات الملكية لكل عنصر.",
              )}
            </p>
          </section>
          {target || unknownCreate ? (
            <section className={styles.card} aria-label={c("Current import", "الاستيراد الحالي")}>
              <h2>{c("Current import", "الاستيراد الحالي")}</h2>
              {target ? (
                <>
                  <p>
                    {c("Original batch", "الدفعة الأصلية")}: <bdi dir="ltr">{target.batchId}</bdi>
                  </p>
                  <p>
                    {c("Original item", "العنصر الأصلي")}: <bdi dir="ltr">{target.itemId}</bdi>
                  </p>
                  {target.transfer === "uploaded" ? (
                    <p>{c("Upload acknowledged", "تم تأكيد الرفع")}</p>
                  ) : null}
                  {target.transfer === "uncertain" && !finishAvailable ? (
                    <StatusNotice tone="warning">
                      {c(
                        "Upload outcome is unconfirmed. Read the original item's status. An interrupted file transfer is not restarted here.",
                        "نتيجة الرفع غير مؤكدة. اقرأ حالة العنصر الأصلي. لا تُعاد محاولة نقل الملف المنقطع هنا.",
                      )}
                    </StatusNotice>
                  ) : null}
                  {finishAvailable ? (
                    <StatusNotice tone="warning">
                      {c(
                        "The file transfer finished. Verify your session, then explicitly finish this original upload without sending the file again.",
                        "اكتمل نقل الملف. تحقق من جلستك، ثم أتمم هذا الرفع الأصلي صراحةً دون إرسال الملف مجددًا.",
                      )}
                    </StatusNotice>
                  ) : null}
                  {active ? <DataBadge>{labels[seedPhase(active)]}</DataBadge> : null}
                  <div className={styles.actions}>
                    <ActionButton
                      tone="secondary"
                      disabled={busy}
                      onClick={() => void refreshBatch(target.batchId)}
                    >
                      {c("Refresh original batch", "تحديث الدفعة الأصلية")}
                    </ActionButton>
                    {finishAvailable ? (
                      <ActionButton disabled={busy} onClick={() => void finishOriginalUpload()}>
                        {c("Finish original upload", "إتمام الرفع الأصلي")}
                      </ActionButton>
                    ) : null}
                    {target.uploadAllowed &&
                    file &&
                    active &&
                    seedPhase(active) === "draft" &&
                    activeBatch?.status !== "ROLLED_BACK" ? (
                      <ActionButton disabled={busy} onClick={() => void continueUpload()}>
                        {c("Continue original upload", "متابعة الرفع الأصلي")}
                      </ActionButton>
                    ) : null}
                    {active && ["published", "rolledBack", "ready"].includes(seedPhase(active)) ? (
                      <ActionButton
                        tone="quiet"
                        disabled={busy}
                        onClick={() => {
                          retain(null);
                          setActiveBatch(null);
                          setFile(null);
                          setDraft(blankDraft(requestedChannelId));
                          setProgress(0);
                          setMessage(null);
                        }}
                      >
                        {c("Add another item", "إضافة عنصر آخر")}
                      </ActionButton>
                    ) : null}
                  </div>
                </>
              ) : (
                <StatusNotice tone="warning">
                  {c(
                    "Batch creation may have completed. Refresh recent batches and review the matching source and title before opening the original batch. Creating a duplicate is blocked.",
                    "ربما اكتمل إنشاء الدفعة. حدّث الدفعات الأخيرة وراجع المصدر والعنوان المطابقين قبل فتح الدفعة الأصلية. تم منع إنشاء نسخة مكررة.",
                  )}
                </StatusNotice>
              )}
              {busy || progress > 0 ? (
                <label>
                  {c("Upload progress", "تقدم الرفع")}
                  <progress max={100} value={progress} style={{ width: "100%" }} />
                  <span>{progress}%</span>
                </label>
              ) : null}
            </section>
          ) : (
            <section className={styles.card}>
              <h2>{c("Add catalog content", "إضافة محتوى للمكتبة")}</h2>
              {!channels.length ? (
                <StatusNotice>
                  {c(
                    "No AYIN-owned channels are available. An Operations administrator must mark the destination as platform-owned first.",
                    "لا توجد قنوات مملوكة لـ AYIN متاحة. يجب على مسؤول العمليات تحديد ملكية المنصة للقناة أولًا.",
                  )}
                </StatusNotice>
              ) : null}
              <form onSubmit={submit}>
                <fieldset
                  disabled={locked || !channels.length}
                  className={styles.formGrid}
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <SelectField
                    id="seed-channel"
                    label={c("AYIN-owned channel", "قناة مملوكة لـ AYIN")}
                    required
                    value={draft.channelId}
                    onChange={(e) => setDraft({ ...draft, channelId: e.target.value })}
                  >
                    <option value="">{c("Choose channel", "اختر قناة")}</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name} (@{channel.handle})
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    id="seed-source"
                    label={c("Source / batch label", "المصدر / اسم الدفعة")}
                    dir="auto"
                    required
                    minLength={2}
                    maxLength={200}
                    value={draft.sourceLabel}
                    onChange={(e) => setDraft({ ...draft, sourceLabel: e.target.value })}
                  />
                  <TextField
                    id="seed-title"
                    label={c("Title", "العنوان")}
                    dir="auto"
                    required
                    maxLength={200}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <TextAreaField
                    id="seed-description"
                    label={c("Description", "الوصف")}
                    dir="auto"
                    maxLength={20000}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                  <SelectField
                    id="seed-type"
                    label={c("Content type", "نوع المحتوى")}
                    value={draft.contentType}
                    onChange={(e) => setDraft({ ...draft, contentType: e.target.value })}
                  >
                    <option value="CREATOR_VIDEO">{c("Creator video", "فيديو منشئ")}</option>
                    <option value="MOVIE">{c("Movie", "فيلم")}</option>
                    <option value="DOCUMENTARY">{c("Documentary", "وثائقي")}</option>
                  </SelectField>
                  <SelectField
                    id="seed-visibility"
                    label={c("Visibility", "مستوى الظهور")}
                    value={draft.visibility}
                    onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
                  >
                    <option value="PUBLIC">{c("Public", "عام")}</option>
                    <option value="UNLISTED">{c("Unlisted", "غير مدرج")}</option>
                    <option value="PRIVATE">{c("Private", "خاص")}</option>
                  </SelectField>
                  <SelectField
                    id="seed-rights"
                    label={c("Rights basis", "أساس الحقوق")}
                    value={draft.rightsBasis}
                    onChange={(e) => setDraft({ ...draft, rightsBasis: e.target.value })}
                  >
                    <option value="OWNED">
                      {c("Owned by AYIN / rights holder", "ملك لـ AYIN / صاحب الحقوق")}
                    </option>
                    <option value="LICENSED">{c("Licensed", "مرخّص")}</option>
                    <option value="AUTHORIZED">
                      {c("Explicitly authorized", "مصرّح به صراحةً")}
                    </option>
                    <option value="PUBLIC_DOMAIN">{c("Public domain", "ملك عام")}</option>
                    <option value="OTHER">{c("Other documented basis", "أساس موثّق آخر")}</option>
                  </SelectField>
                  <TextAreaField
                    id="seed-evidence"
                    label={c("Rights evidence / source notes", "إثبات الحقوق / ملاحظات المصدر")}
                    hint={c(
                      "Source reference, rights statement and required attribution.",
                      "مرجع المصدر وبيان الحقوق ونسب العمل المطلوب.",
                    )}
                    dir="auto"
                    required
                    minLength={3}
                    maxLength={10000}
                    value={draft.sourceNotes}
                    onChange={(e) => setDraft({ ...draft, sourceNotes: e.target.value })}
                  />
                  <TextField
                    id="seed-file"
                    label={c("MP4 video", "فيديو MP4")}
                    required
                    accept="video/mp4,.mp4"
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <p>
                    {c(
                      "After upload, refresh processing status. Publishing always requires a separate review and explicit action on the ready item.",
                      "بعد الرفع، حدّث حالة المعالجة. يتطلب النشر دائمًا مراجعة منفصلة وإجراءً صريحًا للعنصر الجاهز.",
                    )}
                  </p>
                  <ActionButton type="submit" pending={busy}>
                    {c("Upload for review", "رفع للمراجعة")}
                  </ActionButton>
                </fieldset>
              </form>
            </section>
          )}
          <PageHeader
            level={2}
            title={c("Recent seed batches", "دفعات الاستيراد الأخيرة")}
            description={c(
              "Latest 50 batches. Open a batch to keep its original identity available for status checks.",
              "آخر 50 دفعة. افتح دفعة للاحتفاظ بمعرّفها الأصلي عند التحقق من الحالة.",
            )}
            actions={
              <ActionButton tone="secondary" disabled={busy} onClick={() => void refreshRecent()}>
                {c("Refresh recent batches", "تحديث الدفعات الأخيرة")}
              </ActionButton>
            }
          />
          <section className={styles.grid}>
            {batches.map((batch) => (
              <article className={styles.card} key={batch.id} data-seed-batch={batch.id}>
                <h3 dir="auto">{batch.sourceLabel}</h3>
                <p>
                  <bdi>@{batch.channel.handle}</bdi> ·{" "}
                  {new Date(batch.createdAt).toLocaleString(locale)}
                </p>
                {batch.items.map((item) => (
                  <div key={item.id} data-seed-item={item.id} style={{ marginBlock: "16px" }}>
                    <h4 dir="auto">{item.video.title}</h4>
                    <DataBadge>{labels[seedPhase(item)]}</DataBadge>
                    {seedPhase(item) === "processing" ? (
                      <p>
                        {c(
                          "Upload received. AYIN is preparing playback. Refresh this batch to check readiness.",
                          "تم استلام الرفع. يُجهّز AYIN التشغيل. حدّث هذه الدفعة للتحقق من الجاهزية.",
                        )}
                      </p>
                    ) : null}
                    {seedPhase(item) === "failed" ? (
                      <StatusNotice tone="warning">
                        {c(
                          "Processing failed. Review this video in Media Processing and use its existing retry controls, then refresh this batch.",
                          "فشلت المعالجة. راجع هذا الفيديو في معالجة الوسائط واستخدم أدوات إعادة المحاولة المتاحة، ثم حدّث هذه الدفعة.",
                        )}{" "}
                        <ActionLink href="/admin/operations/media">
                          {c("Open Media Processing", "فتح معالجة الوسائط")}
                        </ActionLink>
                        <p>
                          {c("Video ID", "معرّف الفيديو")}: <bdi dir="ltr">{item.video.id}</bdi>
                        </p>
                      </StatusNotice>
                    ) : null}
                    {uncertain.includes(item.id) ? (
                      <StatusNotice tone="warning">
                        {c(
                          "Publication outcome is unknown. Refresh this batch. Publication will not be repeated while the outcome is unconfirmed.",
                          "نتيجة النشر غير معروفة. حدّث هذه الدفعة. لن يُكرر النشر ما دامت النتيجة غير مؤكدة.",
                        )}
                      </StatusNotice>
                    ) : null}
                    <details>
                      <summary>{c("Rights evidence", "إثبات الحقوق")}</summary>
                      <p>
                        <bdi>{item.rightsBasis}</bdi>
                      </p>
                      <p dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {item.sourceNotes}
                      </p>
                    </details>
                    {seedPhase(item) === "ready" && batch.status !== "ROLLED_BACK" ? (
                      <ActionButton
                        disabled={locked || uncertain.includes(item.id)}
                        onClick={() => void mutate(batch, item)}
                      >
                        {c("Publish", "نشر")}
                      </ActionButton>
                    ) : null}
                  </div>
                ))}
                <div className={styles.actions}>
                  <ActionButton
                    tone="secondary"
                    disabled={busy}
                    onClick={() => void refreshBatch(batch.id)}
                  >
                    {c("Refresh batch status", "تحديث حالة الدفعة")}
                  </ActionButton>
                  {!target && batch.items[0] ? (
                    <ActionButton
                      tone="quiet"
                      disabled={busy}
                      onClick={() => {
                        const item = batch.items[0]!;
                        retain({
                          batchId: batch.id,
                          itemId: item.id,
                          uploadAllowed: false,
                          transfer: "none",
                        });
                        setActiveBatch(batch);
                        setUnknownCreate(false);
                        setFile(null);
                        setDraft(blankDraft());
                      }}
                    >
                      {c("Open original batch", "فتح الدفعة الأصلية")}
                    </ActionButton>
                  ) : null}
                  {canRollbackSeed(batch) ? (
                    <ActionButton
                      tone="danger"
                      disabled={locked || uncertain.includes(batch.id)}
                      onClick={() => setRollbackTarget(batch)}
                    >
                      {c("Roll back unpublished batch", "التراجع عن الدفعة غير المنشورة")}
                    </ActionButton>
                  ) : null}
                </div>
                {uncertain.includes(batch.id) ? (
                  <StatusNotice tone="warning">
                    {c(
                      "Rollback outcome is unknown. Refresh before continuing.",
                      "نتيجة التراجع غير معروفة. حدّث الحالة قبل المتابعة.",
                    )}
                  </StatusNotice>
                ) : null}
              </article>
            ))}
            {!batches.length ? (
              <p>{c("No seed batches yet.", "لا توجد دفعات استيراد بعد.")}</p>
            ) : null}
          </section>
          <ConfirmationDialog
            open={rollbackTarget !== null}
            title={c("Roll back unpublished batch?", "التراجع عن الدفعة غير المنشورة؟")}
            description={c(
              `Roll back “${rollbackTarget?.sourceLabel ?? ""}”? Its uploaded objects will be removed. Published items are protected.`,
              `هل تريد التراجع عن «${rollbackTarget?.sourceLabel ?? ""}»؟ ستُزال الملفات المرفوعة. العناصر المنشورة محمية.`,
            )}
            confirmLabel={c("Roll back batch", "التراجع عن الدفعة")}
            cancelLabel={c("Cancel", "إلغاء")}
            direction={direction}
            busy={busy}
            onConfirm={() => {
              if (rollbackTarget) void mutate(rollbackTarget);
            }}
            onCancel={() => setRollbackTarget(null)}
          />
        </div>
      ) : null}
    </>
  );
}
