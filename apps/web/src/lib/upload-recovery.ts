import type { UploadFileIdentity, UploadRecoveryCommandResponse } from "@ayin/types";
import { apiBaseUrl } from "./api";
import { readBoundedAccountJson } from "./account-scope";
import { uploadId, uploadRecord } from "./quick-upload-contract";
import { UploadProtocolError } from "./upload-session";
import { identifyUploadFile } from "./upload-file-identity";
import { titleFromFilename } from "./title-from-filename";
import { isSupportedVideoFile, videoMimeTypeForUpload } from "./video-inspection";
import { UploadBlobError } from "./direct-video-upload";
import {
  parseRecoveryInspection,
  parseRecoveryScope,
  parseRecoveryResponse,
  sameScope,
  type RecoveryScope,
  type RecoveryInspection,
  type RecoveryCommand,
  type SavedRecovery,
} from "./upload-recovery-contract";
import { clearSavedRecovery, loadSavedRecovery, saveRecovery } from "./upload-recovery-storage";

export class RecoveryError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly identityUnverified = false,
  ) {
    super(code);
  }
}
export interface RecoveryView {
  scope: RecoveryScope | null;
  supported: boolean;
  maxSourceBytes?: number;
  saved: SavedRecovery | null;
  inspection: RecoveryInspection | null;
  fileName: string | null;
  fileMatched: boolean;
  busy: boolean;
  progress: number;
  uploadProgress: number;
  uploadedBytes: number;
  message: string;
}
type RecoveryDependencies = {
  storage: Storage;
  fetch?: typeof fetch;
  identify?: typeof identifyUploadFile;
  requestId?: () => string;
  transfer?: (
    url: string,
    blob: Blob,
    headers: Record<string, string>,
    progress: (loaded: number) => void,
    signal: AbortSignal,
  ) => Promise<unknown>;
  changed: (view: RecoveryView) => void;
};
const rejectedBeforeDispatch = new Set([
  "UPLOAD_COMPLETE_PREFLIGHT",
  "UPLOAD_CANARY_BUSY",
  "UPLOAD_CAPACITY_BUSY",
  "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
  "UPLOAD_PHYSICAL_DEBT_LIMIT",
  "UPLOAD_FILE_CHANGED",
  "UPLOAD_STATE_CHANGED",
  "UPLOAD_REQUEST_CONFLICT",
  "UPLOAD_COMMAND_LIMIT",
  "INVALID_PART",
  "INVALID_UPLOAD_COMMAND",
  "UPLOAD_ADMISSION_LIMIT",
  "CHANNEL_UPLOAD_QUOTA_REACHED",
  "UPLOAD_PART_LIMIT",
  "UPLOAD_RATE_LIMITED",
  "VIDEO_TOO_LARGE",
  "UNSUPPORTED_VIDEO_TYPE",
  "INVALID_RECOVERABLE_DRAFT",
  "CLIP_TOO_LONG",
  "CLIPS_DISABLED",
]);
// These may be emitted after provider dispatch by CREATE/AUTHORIZE/COMPLETE.
// Only the wholly transactional RESUME/CANCEL can treat them as a rejection.
const atomicRejections = new Set([
  "UPLOAD_RECOVERY_CHANGED",
  "UPLOAD_RECOVERY_EXPIRED",
  "UPLOAD_RECOVERY_UNSUPPORTED",
]);
/** A single explicit operation at a time; no background transfer, POST retry, grant cache or replay. */
export class UploadRecoveryClient {
  private view: RecoveryView = {
    scope: null,
    supported: false,
    saved: null,
    inspection: null,
    fileName: null,
    fileMatched: false,
    busy: false,
    progress: 0,
    uploadProgress: 0,
    uploadedBytes: 0,
    message: "INITIAL",
  };
  private file: File | null = null;
  private identity: UploadFileIdentity | null = null;
  private operation: AbortController | null = null;
  private operationSettled: Promise<void> = Promise.resolve();
  private terminalExitConfirmed = false;
  private loginSessionId: string | null = null;
  private readonly fetcher: typeof fetch;
  constructor(private readonly dependencies: RecoveryDependencies) {
    this.fetcher = (dependencies.fetch ?? globalThis.fetch).bind(globalThis);
  }
  getSnapshot(): RecoveryView {
    return { ...this.view };
  }
  private publish() {
    this.dependencies.changed({ ...this.view });
  }
  private retain(saved: SavedRecovery) {
    saveRecovery(this.dependencies.storage, saved);
    this.view.saved = saved;
  }
  private discardAuthority() {
    this.terminalExitConfirmed = false;
    this.loginSessionId = null;
    this.file = null;
    this.identity = null;
    this.view = {
      ...this.view,
      scope: null,
      supported: false,
      saved: null,
      inspection: null,
      fileName: null,
      fileMatched: false,
    };
    try {
      clearSavedRecovery(this.dependencies.storage);
    } catch {
      /* Keep private facts hidden if device storage is unavailable. */
    }
  }
  /** Hide private facts immediately on pagehide/background; require a fresh authenticated read. */
  suspend(verifiedViewerScope?: RecoveryScope) {
    this.terminalExitConfirmed = false;
    this.loginSessionId = null;
    this.operation?.abort();
    this.operation = null;
    this.file = null;
    this.identity = null;
    this.view = {
      scope: null,
      supported: false,
      saved: null,
      inspection: null,
      fileName: null,
      fileMatched: false,
      busy: false,
      progress: 0,
      uploadProgress: 0,
      uploadedBytes: 0,
      message: "INITIAL",
    };
    if (verifiedViewerScope) {
      // A newly verified header identity may discard another account/profile's
      // device marker, but never restores its facts or restarts a transfer.
      try {
        loadSavedRecovery(this.dependencies.storage, parseRecoveryScope(verifiedViewerScope));
      } catch {
        /* Device storage may be unavailable. */
      }
    }
    this.publish();
  }
  stop() {
    this.operation?.abort(new RecoveryError("STOPPED"));
  }
  private async request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    expectedScope?: RecoveryScope,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(() => controller.abort(new RecoveryError("UNCERTAIN")), 15_000);
    try {
      const response = await this.fetcher(`${apiBaseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: {
          ...(expectedScope || this.view.scope
            ? { "x-ayin-expected-account": (expectedScope ?? this.view.scope)!.accountId }
            : {}),
          ...(this.loginSessionId ? { "x-ayin-expected-session": this.loginSessionId } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let code = "UNAVAILABLE";
        try {
          const raw = uploadRecord(
              await readBoundedAccountJson(response, controller.signal, 16384),
            ),
            error = uploadRecord(raw.error);
          if (typeof error.code === "string" && /^[A-Z_]{1,100}$/.test(error.code))
            code = error.code;
        } catch {
          /* Never display arbitrary server text. */
        }
        throw new RecoveryError(code, response.status);
      }
      if (body !== undefined && response.status !== 201) throw new UploadProtocolError();
      return await readBoundedAccountJson(
        response,
        controller.signal,
        path.endsWith("/inspection") || path === "/auth/sessions" ? 1024 * 1024 : 65536,
      );
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  private async scope(signal: AbortSignal, expectedScope?: RecoveryScope) {
    try {
      return await this.readScope(signal, expectedScope);
    } catch (error) {
      if (signal.aborted) throw error;
      if (
        error instanceof RecoveryError &&
        (error.status === 401 ||
          error.status === 403 ||
          ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(error.code))
      )
        throw error;
      throw new RecoveryError("AUTHORITY_UNVERIFIED", 0, true);
    }
  }
  private async readScope(signal: AbortSignal, expectedScope?: RecoveryScope) {
    const raw = uploadRecord(await this.request("/auth/me", signal, undefined, expectedScope));
    const scope = {
      accountId: uploadId(uploadRecord(raw.account).id),
      channelId: uploadId(uploadRecord(raw.channel).id),
      profileId: uploadId(uploadRecord(raw.profile).id),
    };
    if (this.view.scope && !sameScope(this.view.scope, scope))
      throw new RecoveryError("AUTHORITY_CHANGED", 403);
    if (expectedScope && !sameScope(expectedScope, scope))
      throw new RecoveryError("AUTHORITY_CHANGED", 403);
    if (!this.loginSessionId) {
      const list = uploadRecord(await this.request("/auth/sessions", signal, undefined, scope));
      if (!Array.isArray(list.sessions) || list.sessions.length > 1000)
        throw new UploadProtocolError();
      const current = list.sessions.map(uploadRecord).filter((entry) => entry.current === true);
      if (current.length !== 1) throw new UploadProtocolError();
      this.loginSessionId = uploadId(current[0]!.id);
    }
    return scope;
  }
  private async run(action: (signal: AbortSignal) => Promise<void>) {
    if (this.operation) return;
    const controller = new AbortController();
    this.operation = controller;
    let settled!: () => void;
    this.operationSettled = new Promise<void>((resolve) => (settled = resolve));
    this.view.busy = true;
    this.view.message = "WORKING";
    this.publish();
    try {
      await action(controller.signal);
      controller.signal.throwIfAborted();
    } catch (error) {
      if (this.operation !== controller) return;
      this.view.inspection = null;
      this.view.fileMatched = false;
      if (
        error instanceof RecoveryError &&
        (error.status === 401 ||
          error.status === 403 ||
          ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(error.code))
      ) {
        this.discardAuthority();
        this.view.message = "AUTHORITY_CHANGED";
      } else if (error instanceof RecoveryError && error.identityUnverified) {
        this.suspend();
        this.view.message = "AUTHORITY_UNVERIFIED";
        this.publish();
      } else
        this.view.message =
          error instanceof RecoveryError
            ? error.code
            : error instanceof UploadProtocolError
              ? "INVALID_RESPONSE"
              : "UNCERTAIN";
    } finally {
      if (this.operation === controller) {
        this.operation = null;
        this.view.busy = false;
        this.publish();
      }
      settled();
    }
  }
  async open() {
    await this.run(async (signal) => {
      await this.openWorkspace(signal);
    });
  }
  private async openWorkspace(signal: AbortSignal, keepFile = false) {
    this.terminalExitConfirmed = false;
    const previousSessionId = this.view.saved?.session?.sessionId;
    if (!keepFile) {
      this.file = null;
      this.identity = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
    }
    this.view.inspection = null;
    const scope = await this.scope(signal);
    const capability = uploadRecord(
      await this.request(
        `/media/uploads/sessions/capability?channelId=${encodeURIComponent(scope.channelId)}`,
        signal,
        undefined,
        scope,
      ),
    );
    if (
      capability.protocolVersion !== 1 ||
      typeof capability.supported !== "boolean" ||
      capability.reason !== (capability.supported ? null : "UNSUPPORTED")
    )
      throw new UploadProtocolError();
    if (
      capability.maxSourceBytes !== undefined &&
      (typeof capability.maxSourceBytes !== "number" ||
        !Number.isSafeInteger(capability.maxSourceBytes) ||
        capability.maxSourceBytes < 1)
    )
      throw new UploadProtocolError();
    const last = await this.scope(signal, scope);
    if (!sameScope(scope, last)) throw new RecoveryError("AUTHORITY_CHANGED", 403);
    signal.throwIfAborted();
    this.view.scope = scope;
    this.view.supported = capability.supported;
    if (capability.supported && typeof capability.maxSourceBytes === "number")
      this.view.maxSourceBytes = capability.maxSourceBytes;
    else delete this.view.maxSourceBytes;
    this.view.saved = loadSavedRecovery(this.dependencies.storage, scope);
    if (previousSessionId !== this.view.saved?.session?.sessionId) {
      this.view.fileMatched = false;
      this.view.uploadProgress = 0;
      this.view.uploadedBytes = 0;
    }
    this.view.message = this.view.saved
      ? "SAVED"
      : capability.supported
        ? "CHOOSE_FILE"
        : "UPLOAD_RECOVERY_UNSUPPORTED";
  }
  async check() {
    await this.run(async (signal) => {
      await this.openWorkspace(signal, Boolean(this.view.scope));
      if (this.view.saved) await this.inspectSaved(signal);
    });
  }
  async choose(file: File) {
    await this.run(async (signal) => {
      if (
        !this.view.scope ||
        (!this.view.supported && !this.view.saved) ||
        !file.size ||
        !isSupportedVideoFile(file)
      )
        throw new RecoveryError("INVALID_FILE");
      await this.scope(signal);
      this.file = null;
      this.identity = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
      if (this.view.saved?.session && file.size !== this.view.saved.session.sizeBytes)
        throw new RecoveryError("UPLOAD_FILE_CHANGED");
      if (
        !this.view.saved &&
        this.view.maxSourceBytes !== undefined &&
        file.size > this.view.maxSourceBytes
      )
        throw new RecoveryError("VIDEO_TOO_LARGE");
      this.view.message = "HASHING";
      this.view.progress = 0;
      this.publish();
      const identity = await (this.dependencies.identify ?? identifyUploadFile)(
        file,
        signal,
        (progress) => {
          if (!signal.aborted) {
            this.view.progress = progress;
            this.publish();
          }
        },
      );
      await this.scope(signal);
      signal.throwIfAborted();
      this.file = file;
      this.identity = identity;
      this.view.fileName = file.name;
      this.view.message = this.view.saved ? "FILE_CHECKED" : "CREATE_READY";
    });
  }
  async create(
    options: { title?: string; durationMs?: number | null; videoForm?: "LONG_FORM" | "CLIP" } = {},
  ) {
    await this.run(async (signal) => {
      if (
        !this.file ||
        !this.identity ||
        !this.view.supported ||
        this.view.saved ||
        !this.view.scope
      )
        throw new RecoveryError("NOT_READY");
      await this.scope(signal);
      const requestId = (this.dependencies.requestId ?? (() => crypto.randomUUID()))();
      const saved: SavedRecovery = {
        version: 1,
        scope: this.view.scope,
        creationRequestId: requestId,
        session: null,
        pending: { kind: "CREATE", requestId },
      };
      this.retain(saved); // Persist the marker before any possible server dispatch.
      let raw: unknown;
      try {
        raw = await this.request("/creator/videos/recoverable-drafts", signal, {
          requestId,
          channelId: saved.scope.channelId,
          title: options.title ?? titleFromFilename(this.file.name),
          sizeBytes: this.file.size,
          mimeType: videoMimeTypeForUpload(this.file),
          fileIdentity: this.identity,
          ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
          ...(options.videoForm ? { videoForm: options.videoForm } : {}),
        });
      } catch (error) {
        if (error instanceof RecoveryError && rejectedBeforeDispatch.has(error.code)) {
          clearSavedRecovery(this.dependencies.storage);
          this.view.saved = null;
        }
        if (error instanceof RecoveryError && error.code === "UPLOAD_RECOVERY_UNSUPPORTED")
          this.view.supported = false;
        throw error;
      }
      const response = parseRecoveryResponse(raw, saved.scope, requestId, null);
      if (
        response.session.sizeBytes !== this.file.size ||
        response.session.mimeType !== videoMimeTypeForUpload(this.file)
      )
        throw new UploadProtocolError();
      await this.scope(signal);
      signal.throwIfAborted();
      this.accept(response, saved);
      this.view.fileMatched =
        response.operation.status === "SUCCEEDED" && response.session.state === "OPEN";
      this.view.message = this.view.fileMatched ? "INSPECT_BEFORE_UPLOAD" : "UNCERTAIN";
    });
  }
  private accept(
    response: UploadRecoveryCommandResponse,
    saved: SavedRecovery,
    keepPending = false,
  ) {
    const terminal = ["ABORTED", "REVOKED", "EXPIRED"].includes(response.session.state);
    this.terminalExitConfirmed =
      (response.session.state === "COMPLETED" && response.operation.status === "SUCCEEDED") ||
      (terminal &&
        (response.cleanup?.authorityRevoked === true ||
          (response.operation.status === "SUCCEEDED" &&
            (response.session.state !== "EXPIRED" || saved.pending?.kind === "CANCEL"))));
    this.retain({
      ...saved,
      session: response.session,
      pending: response.operation.status === "SUCCEEDED" && !keepPending ? null : saved.pending,
    });
    this.view.inspection = null;
    this.view.message = response.cleanup
      ? "CANCELLED_PENDING"
      : response.session.state === "COMPLETED"
        ? "COMPLETED"
        : response.operation.status === "SUCCEEDED"
          ? "SAVED"
          : "UNCERTAIN";
  }
  async inspect() {
    await this.run(async (signal) => {
      await this.inspectSaved(signal);
    });
  }
  private async inspectSaved(signal: AbortSignal) {
    let saved = this.view.saved;
    if (!saved) throw new RecoveryError("NOT_READY");
    await this.scope(signal);
    {
      let requestId = saved.pending?.requestId ?? saved.creationRequestId;
      const path =
        saved.session && saved.pending
          ? `/media/uploads/sessions/${saved.session.sessionId}/operations/${saved.pending.requestId}`
          : `/creator/videos/recoverable-drafts/${saved.creationRequestId}`;
      let raw: unknown;
      let unusedAuthorization = false;
      try {
        raw = await this.request(path, signal);
      } catch (error) {
        if (
          !(error instanceof RecoveryError) ||
          error.status !== 404 ||
          error.code !== "UPLOAD_RECOVERY_NOT_FOUND" ||
          saved.pending?.kind !== "AUTHORIZE" ||
          !saved.session
        )
          throw error;
        // The tab may close after persisting a grant request, before dispatch.
        // An unused authorization cannot itself send file bytes. Inspect this
        // same session through its known CREATE outcome; never retry CREATE or
        // COMPLETE, and never recover or reuse the missing grant URL.
        requestId = saved.creationRequestId;
        raw = await this.request(`/creator/videos/recoverable-drafts/${requestId}`, signal);
        unusedAuthorization = true;
      }
      const response = parseRecoveryResponse(raw, saved.scope, requestId, saved.session);
      if (!response.operation.replayed) throw new UploadProtocolError();
      if (
        unusedAuthorization &&
        !(
          (response.operation.status === "SUCCEEDED" && response.session.state === "OPEN") ||
          (["ABORTED", "REVOKED", "EXPIRED"].includes(response.session.state) &&
            response.cleanup?.authorityRevoked === true)
        )
      )
        throw new RecoveryError("UNCERTAIN");
      await this.scope(signal);
      signal.throwIfAborted();
      this.accept(response, saved);
      saved = this.view.saved!;
      if (response.operation.status !== "SUCCEEDED") {
        this.view.message = this.terminalExitConfirmed ? "CANCELLED_PENDING" : "UNCERTAIN";
        return;
      }
    }
    if (!saved.session) throw new RecoveryError("NOT_READY");
    if (!["OPEN", "PREPARING"].includes(saved.session.state)) {
      this.view.message =
        saved.session.state === "COMPLETED"
          ? "COMPLETED"
          : saved.session.state === "ABORTED"
            ? "CANCELLED_PENDING"
            : this.terminalExitConfirmed
              ? "CLOSED"
              : saved.session.state === "EXPIRED"
                ? "EXPIRED"
                : "UNRESOLVED";
      return;
    }
    const inspection = parseRecoveryInspection(
      await this.request(`/media/uploads/sessions/${saved.session.sessionId}/inspection`, signal),
      saved.scope,
      saved.session,
    );
    await this.scope(signal);
    signal.throwIfAborted();
    this.retain({ ...saved, session: inspection.session });
    this.view.inspection = inspection;
    this.view.uploadProgress = Math.floor(
      (100 * this.observedBytes()) / inspection.session.sizeBytes,
    );
    this.view.uploadedBytes = this.observedBytes();
    this.view.message =
      Date.parse(inspection.session.expiresAt) <= Date.now()
        ? "EXPIRED"
        : inspection.observation.kind === "STORED_UNVERIFIED"
          ? "STORED_UNVERIFIED"
          : "INSPECTED";
  }
  private async command(
    kind: Exclude<RecoveryCommand, "CREATE">,
    signal: AbortSignal,
    extra: Record<string, unknown> = {},
  ) {
    const saved = this.view.saved;
    if (!saved?.session || (saved.pending && kind !== "CANCEL"))
      throw new RecoveryError("NOT_READY");
    if (kind !== "CANCEL" && Date.parse(saved.session.expiresAt) <= Date.now())
      throw new RecoveryError("EXPIRED");
    await this.scope(signal);
    const requestId = (this.dependencies.requestId ?? (() => crypto.randomUUID()))();
    const pending: SavedRecovery = { ...saved, pending: { kind, requestId } };
    this.retain(pending);
    let raw: unknown;
    try {
      raw = await this.request(
        `/media/uploads/sessions/${saved.session.sessionId}/${kind.toLowerCase()}`,
        signal,
        { requestId, expectedRevision: saved.session.revision, ...extra },
      );
    } catch (error) {
      if (
        error instanceof RecoveryError &&
        (rejectedBeforeDispatch.has(error.code) ||
          (kind === "CANCEL" && error.code === "UPLOAD_ALREADY_ACCEPTED") ||
          (["RESUME", "CANCEL"].includes(kind) && atomicRejections.has(error.code)))
      )
        this.retain(saved);
      throw error;
    }
    const response = parseRecoveryResponse(
      raw,
      saved.scope,
      requestId,
      saved.session,
      kind === "AUTHORIZE" ? (extra.partNumber as number) : undefined,
    );
    await this.scope(signal);
    signal.throwIfAborted();
    this.accept(response, pending, kind === "AUTHORIZE");
    return response;
  }
  async resume() {
    await this.run(async (signal) => {
      await this.resumeFile(signal);
    });
  }
  private async resumeFile(signal: AbortSignal) {
    if (!this.identity || !this.file || !this.view.inspection || this.view.fileMatched)
      throw new RecoveryError("NOT_READY");
    const inspection = this.view.inspection;
    const response = await this.command("RESUME", signal, { fileIdentity: this.identity });
    this.view.fileMatched =
      response.operation.status === "SUCCEEDED" && response.session.state === "OPEN";
    if (this.view.fileMatched) {
      this.view.inspection = { ...inspection, session: response.session };
      this.view.message = "RESUMED";
    }
  }
  nextPart(): number | null {
    const session = this.view.saved?.session,
      observation = this.view.inspection?.observation;
    if (
      !session ||
      !observation ||
      session.state !== "OPEN" ||
      observation.kind === "STORED_UNVERIFIED"
    )
      return null;
    if (session.mode === "SINGLE") return observation.kind === "UNAVAILABLE" ? 1 : null;
    if (observation.kind !== "PARTS_OBSERVED") return null;
    const existing = new Set(observation.parts.map((part) => part.partNumber));
    for (let n = 1; n <= session.partCount; n++) if (!existing.has(n)) return n;
    return null;
  }
  async uploadNext() {
    await this.run(async (signal) => {
      await this.uploadPart(signal);
    });
  }
  private async uploadPart(signal: AbortSignal) {
    const partNumber = this.nextPart();
    if (!this.view.fileMatched || !this.file || !this.view.supported || !partNumber)
      throw new RecoveryError("NOT_READY");
    const response = await this.command("AUTHORIZE", signal, { partNumber });
    const grant = response.grant;
    if (!grant) {
      this.view.message = "UNCERTAIN";
      return false;
    }
    // This address lives only in this call. Never reuse it after failure/reload.
    const start =
      response.session.mode === "SINGLE" ? 0 : (partNumber - 1) * response.session.partSizeBytes;
    const end =
      response.session.mode === "SINGLE"
        ? this.file.size
        : Math.min(this.file.size, start + response.session.partSizeBytes);
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(120_000, Date.parse(grant.expiresAt) - Date.now())),
    );
    try {
      const uploaded = await this.fetcher(grant.url, {
        method: "PUT",
        headers: grant.headers,
        body: this.file.slice(start, end),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      void uploaded.body?.cancel().catch(() => undefined);
      if (!uploaded.ok) throw new RecoveryError("TRANSFER_UNCERTAIN");
      await this.scope(signal);
      signal.throwIfAborted();
      this.retain({ ...this.view.saved!, pending: null });
      this.view.message = "PART_SENT_INSPECT";
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
    return true;
  }
  private observedBytes() {
    const observation = this.view.inspection?.observation;
    return observation?.kind === "PARTS_OBSERVED"
      ? observation.uploadedBytes
      : observation?.kind === "STORED_UNVERIFIED"
        ? observation.sizeBytes
        : 0;
  }
  async continueUpload(options: { concurrency?: 1 | 3; complete?: boolean } = {}) {
    // One explicit creator intent owns one latch/controller across every part.
    await this.run(async (signal) => {
      if (
        !this.file ||
        !this.identity ||
        !this.view.saved?.session ||
        !this.view.supported ||
        this.view.saved.pending
      )
        throw new RecoveryError("NOT_READY");
      const partLimit = this.view.saved.session.partCount;
      const sent = new Set<number>();
      await this.inspectSaved(signal);
      if (this.view.saved.pending || !["OPEN", "PREPARING"].includes(this.view.saved.session.state))
        return;
      if (!this.view.fileMatched) {
        await this.resumeFile(signal);
        if (!this.view.fileMatched) return;
        await this.inspectSaved(signal);
      }
      if (options.concurrency === 3) {
        await this.uploadBatches(signal);
        if (options.complete && this.canComplete()) await this.completeCurrent(signal);
        return;
      }
      for (let count = 0; count < partLimit; count++) {
        signal.throwIfAborted();
        if (this.canComplete()) {
          this.view.message = "READY_COMPLETE";
          if (options.complete) await this.completeCurrent(signal);
          return;
        }
        const partNumber = this.nextPart(),
          before = this.observedBytes();
        if (!partNumber || sent.has(partNumber)) throw new RecoveryError("TRANSFER_UNCERTAIN");
        sent.add(partNumber);
        this.view.message = "UPLOADING";
        this.publish();
        if (!(await this.uploadPart(signal))) return;
        await this.inspectSaved(signal);
        if (this.view.saved?.pending || this.view.saved?.session?.state !== "OPEN") return;
        const observation = this.view.inspection?.observation;
        const observed =
          observation?.kind === "STORED_UNVERIFIED" ||
          (observation?.kind === "PARTS_OBSERVED" &&
            observation.parts.some((part) => part.partNumber === partNumber));
        // Never replay an acknowledged PUT when the provider view is delayed,
        // incomplete or regresses. A further attempt needs a new user intent.
        if (!observed || this.observedBytes() <= before)
          throw new RecoveryError("TRANSFER_UNCERTAIN");
        this.publish();
      }
      if (!this.canComplete()) throw new RecoveryError("TRANSFER_UNCERTAIN");
      this.view.message = "READY_COMPLETE";
      if (options.complete) await this.completeCurrent(signal);
    });
  }
  private async uploadBatches(signal: AbortSignal) {
    const attempts = new Map<number, number>();
    let highestBytes = this.observedBytes();
    while (!this.canComplete()) {
      signal.throwIfAborted();
      const session = this.view.saved?.session;
      const observation = this.view.inspection?.observation;
      const file = this.file;
      if (!session || !observation || !file || !this.view.fileMatched)
        throw new RecoveryError("NOT_READY");
      const observed = new Set(
        observation.kind === "PARTS_OBSERVED"
          ? observation.parts.map((part) => part.partNumber)
          : [],
      );
      if (session.mode === "MULTIPART" && observation.kind !== "PARTS_OBSERVED")
        throw new RecoveryError("TRANSFER_UNCERTAIN");
      const missing: number[] = [];
      for (let part = 1; part <= session.partCount && missing.length < 3; part++) {
        if (!observed.has(part)) missing.push(part);
      }
      if (!missing.length) throw new RecoveryError("TRANSFER_UNCERTAIN");
      if (missing.some((part) => (attempts.get(part) ?? 0) >= 4))
        throw new RecoveryError("UPLOAD_NETWORK_FAILED");
      const before = this.observedBytes();
      const prepared: {
        partNumber: number;
        blob: Blob;
        grant: NonNullable<UploadRecoveryCommandResponse["grant"]>;
      }[] = [];
      for (const partNumber of missing) {
        const response = await this.command("AUTHORIZE", signal, { partNumber });
        if (!response.grant) {
          this.view.message = "UNCERTAIN";
          return;
        }
        // This command is acknowledged and its one-use URL stays in memory.
        // On reload the provider inventory, never this marker, decides which
        // bytes survived. Unknown authorization outcomes remain persisted.
        this.retain({ ...this.view.saved!, pending: null });
        const start = session.mode === "SINGLE" ? 0 : (partNumber - 1) * session.partSizeBytes;
        prepared.push({
          partNumber,
          blob: file.slice(
            start,
            session.mode === "SINGLE"
              ? file.size
              : Math.min(file.size, start + session.partSizeBytes),
          ),
          grant: response.grant,
        });
      }
      await this.scope(signal);
      signal.throwIfAborted();
      const batch = new AbortController();
      const abort = () => batch.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const bytes = new Map<number, number>();
      this.view.uploadedBytes = Math.max(highestBytes, before);
      this.view.uploadProgress = Math.min(
        99,
        Math.floor((100 * this.view.uploadedBytes) / session.sizeBytes),
      );
      this.view.message = "UPLOADING";
      this.publish();
      let transferError: unknown;
      try {
        await Promise.allSettled(
          prepared.map(async ({ partNumber, blob, grant }) => {
            try {
              batch.signal.throwIfAborted();
              attempts.set(partNumber, (attempts.get(partNumber) ?? 0) + 1);
              await this.transferGrant(grant, blob, batch.signal, (loaded) => {
                if (batch.signal.aborted) return;
                bytes.set(
                  partNumber,
                  Math.max(bytes.get(partNumber) ?? 0, Math.min(blob.size, loaded)),
                );
                highestBytes = Math.max(
                  highestBytes,
                  before + [...bytes.values()].reduce((sum, value) => sum + value, 0),
                );
                this.view.uploadedBytes = highestBytes;
                this.view.uploadProgress = Math.min(
                  99,
                  Math.floor((100 * this.view.uploadedBytes) / session.sizeBytes),
                );
                this.publish();
              });
            } catch (error) {
              if (!batch.signal.aborted) batch.abort(error);
              throw error;
            }
          }),
        );
        batch.signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        transferError = error;
      } finally {
        signal.removeEventListener("abort", abort);
      }
      await this.scope(signal);
      await this.inspectSaved(signal);
      if (this.view.saved?.pending || this.view.saved?.session?.state !== "OPEN") return;
      const next = this.view.inspection?.observation;
      const missingAfter = missing.filter(
        (partNumber) =>
          next?.kind !== "STORED_UNVERIFIED" &&
          (next?.kind !== "PARTS_OBSERVED" ||
            !next.parts.some((part) => part.partNumber === partNumber)),
      );
      if (transferError && missingAfter.length) {
        const retryable =
          transferError instanceof UploadBlobError
            ? transferError.retryable
            : transferError instanceof TypeError ||
              (transferError instanceof RecoveryError &&
                transferError.code === "TRANSFER_UNCERTAIN") ||
              (transferError instanceof DOMException && transferError.name === "TimeoutError");
        if (!retryable) throw new RecoveryError("UPLOAD_STORAGE_REJECTED");
        const attempt = Math.max(
          ...missingAfter.map((partNumber) => attempts.get(partNumber) ?? 1),
        );
        if (attempt >= 4) throw new RecoveryError("UPLOAD_NETWORK_FAILED");
        this.view.message = "RETRYING";
        this.publish();
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
          };
          const timer = setTimeout(
            () => {
              signal.removeEventListener("abort", abort);
              resolve();
            },
            500 * 2 ** Math.max(0, attempt - 1),
          );
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        continue;
      }
      if (
        next?.kind !== "STORED_UNVERIFIED" &&
        (next?.kind !== "PARTS_OBSERVED" ||
          missing.some((partNumber) => !next.parts.some((part) => part.partNumber === partNumber)))
      )
        throw new RecoveryError("TRANSFER_UNCERTAIN");
      this.publish();
    }
    this.view.message = "READY_COMPLETE";
  }
  private async transferGrant(
    grant: NonNullable<UploadRecoveryCommandResponse["grant"]>,
    blob: Blob,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    signal.throwIfAborted();
    if (Date.parse(grant.expiresAt) <= Date.now()) throw new RecoveryError("TRANSFER_UNCERTAIN");
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const deadline = setTimeout(
      () => controller.abort(new RecoveryError("TRANSFER_UNCERTAIN")),
      Math.max(1, Date.parse(grant.expiresAt) - Date.now()),
    );
    try {
      controller.signal.throwIfAborted();
      if (this.dependencies.transfer) {
        await this.dependencies.transfer(
          grant.url,
          blob,
          grant.headers,
          progress,
          controller.signal,
        );
      } else {
        const response = await this.fetcher(grant.url, {
          method: "PUT",
          headers: grant.headers,
          body: blob,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        void response.body?.cancel().catch(() => undefined);
        if (!response.ok)
          throw new UploadBlobError("Storage rejected this upload part.", {
            status: response.status,
            retryable: [408, 425, 429].includes(response.status) || response.status >= 500,
          });
      }
      controller.signal.throwIfAborted();
      progress(blob.size);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  canComplete() {
    const observation = this.view.inspection?.observation,
      session = this.view.saved?.session;
    return Boolean(
      session?.state === "OPEN" &&
      (observation?.kind === "STORED_UNVERIFIED" ||
        (observation?.kind === "PARTS_OBSERVED" && observation.parts.length === session.partCount)),
    );
  }
  async complete() {
    await this.run(async (signal) => {
      await this.completeCurrent(signal);
    });
  }
  private async completeCurrent(signal: AbortSignal) {
    if (!this.view.fileMatched || !this.canComplete()) throw new RecoveryError("NOT_READY");
    this.view.message = "FINALIZING";
    this.publish();
    await this.command("COMPLETE", signal);
    this.file = null;
    this.identity = null;
    this.view.fileName = null;
    this.view.fileMatched = false;
  }
  async reconcileCompletion() {
    await this.run(async (signal) => {
      const saved = this.view.saved;
      if (
        !this.view.scope ||
        !saved?.session ||
        saved.pending?.kind !== "COMPLETE" ||
        !["FINALIZING", "UNRESOLVED"].includes(saved.session.state)
      )
        throw new RecoveryError("NOT_READY");
      if (Date.parse(saved.session.expiresAt) <= Date.now()) throw new RecoveryError("EXPIRED");
      await this.scope(signal, saved.scope);
      let raw: unknown;
      try {
        // Verify the original COMPLETE outcome without replaying that command,
        // minting another request UUID, obtaining a grant or sending file bytes.
        raw = await this.request(
          `/media/uploads/sessions/${saved.session.sessionId}/operations/${saved.pending.requestId}/reconcile`,
          signal,
          { expectedRevision: saved.session.revision },
          saved.scope,
        );
      } catch (error) {
        if (error instanceof RecoveryError && error.code === "UPLOAD_RECOVERY_UNSUPPORTED")
          this.view.supported = false;
        // Even a definitive rejection of this verification attempt says nothing
        // about whether the original COMPLETE reached storage. Keep its marker.
        throw error;
      }
      const response = parseRecoveryResponse(
        raw,
        saved.scope,
        saved.pending.requestId,
        saved.session,
      );
      if (
        !response.operation.replayed ||
        response.cleanup ||
        (response.operation.status === "SUCCEEDED"
          ? response.session.state !== "COMPLETED"
          : !["FINALIZING", "UNRESOLVED"].includes(response.session.state))
      )
        throw new UploadProtocolError();
      await this.scope(signal, saved.scope);
      signal.throwIfAborted();
      this.accept(response, saved);
      if (response.operation.status === "SUCCEEDED") {
        this.file = null;
        this.identity = null;
        this.view.fileName = null;
        this.view.fileMatched = false;
      }
    });
  }
  async cancel() {
    this.stop();
    await this.operationSettled;
    await this.run(async (signal) => {
      if (
        !this.view.saved?.session ||
        ["COMPLETED", "ABORTED", "REVOKED"].includes(this.view.saved.session.state)
      )
        throw new RecoveryError("NOT_READY");
      await this.command("CANCEL", signal);
      this.file = null;
      this.identity = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
    });
  }
  canForgetFinished() {
    return !this.operation && this.terminalExitConfirmed && Boolean(this.view.saved?.session);
  }
  forgetFinished() {
    if (!this.canForgetFinished()) return;
    try {
      clearSavedRecovery(this.dependencies.storage);
      this.file = null;
      this.identity = null;
      this.view.saved = null;
      this.view.inspection = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
      this.view.uploadProgress = 0;
      this.view.uploadedBytes = 0;
      this.terminalExitConfirmed = false;
      this.view.message = this.view.supported ? "CHOOSE_FILE" : "UPLOAD_RECOVERY_UNSUPPORTED";
    } catch {
      this.view.message = "STORAGE_UNAVAILABLE";
    }
    this.publish();
  }
}
