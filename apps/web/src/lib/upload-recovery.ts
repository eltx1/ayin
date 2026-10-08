import type { UploadFileIdentity, UploadRecoveryCommandResponse } from "@ayin/types";
import { apiBaseUrl } from "./api";
import { readBoundedAccountJson } from "./account-scope";
import { uploadId, uploadRecord } from "./quick-upload-contract";
import { UploadProtocolError } from "./upload-session";
import { identifyUploadFile } from "./upload-file-identity";
import { titleFromFilename } from "./title-from-filename";
import { isSupportedVideoFile, videoMimeTypeForUpload } from "./video-inspection";
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
  saved: SavedRecovery | null;
  inspection: RecoveryInspection | null;
  fileName: string | null;
  fileMatched: boolean;
  busy: boolean;
  progress: number;
  uploadProgress: number;
  message: string;
}
type RecoveryDependencies = {
  storage: Storage;
  fetch?: typeof fetch;
  identify?: typeof identifyUploadFile;
  requestId?: () => string;
  changed: (view: RecoveryView) => void;
};
const rejectedBeforeDispatch = new Set([
  "UPLOAD_COMPLETE_PREFLIGHT",
  "UPLOAD_CANARY_BUSY",
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
    message: "INITIAL",
  };
  private file: File | null = null;
  private identity: UploadFileIdentity | null = null;
  private operation: AbortController | null = null;
  private loginSessionId: string | null = null;
  private readonly fetcher: typeof fetch;
  constructor(private readonly dependencies: RecoveryDependencies) {
    this.fetcher = (dependencies.fetch ?? globalThis.fetch).bind(globalThis);
  }
  private publish() {
    this.dependencies.changed({ ...this.view });
  }
  private retain(saved: SavedRecovery) {
    saveRecovery(this.dependencies.storage, saved);
    this.view.saved = saved;
  }
  private discardAuthority() {
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
    }
  }
  async open() {
    await this.run(async (signal) => {
      await this.openWorkspace(signal);
    });
  }
  private async openWorkspace(signal: AbortSignal, keepFile = false) {
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
    const last = await this.scope(signal, scope);
    if (!sameScope(scope, last)) throw new RecoveryError("AUTHORITY_CHANGED", 403);
    signal.throwIfAborted();
    this.view.scope = scope;
    this.view.supported = capability.supported;
    this.view.saved = loadSavedRecovery(this.dependencies.storage, scope);
    if (previousSessionId !== this.view.saved?.session?.sessionId) {
      this.view.fileMatched = false;
      this.view.uploadProgress = 0;
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
  async create() {
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
          title: titleFromFilename(this.file.name),
          sizeBytes: this.file.size,
          mimeType: videoMimeTypeForUpload(this.file),
          fileIdentity: this.identity,
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
      const requestId = saved.pending?.requestId ?? saved.creationRequestId;
      const path =
        saved.session && saved.pending
          ? `/media/uploads/sessions/${saved.session.sessionId}/operations/${saved.pending.requestId}`
          : `/creator/videos/recoverable-drafts/${saved.creationRequestId}`;
      const response = parseRecoveryResponse(
        await this.request(path, signal),
        saved.scope,
        requestId,
        saved.session,
      );
      if (!response.operation.replayed) throw new UploadProtocolError();
      await this.scope(signal);
      signal.throwIfAborted();
      this.accept(response, saved);
      saved = this.view.saved!;
      if (response.operation.status !== "SUCCEEDED") {
        this.view.message = "UNCERTAIN";
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
  async continueUpload() {
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
      for (let count = 0; count < partLimit; count++) {
        signal.throwIfAborted();
        if (this.canComplete()) {
          this.view.message = "READY_COMPLETE";
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
    });
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
      if (!this.view.fileMatched || !this.canComplete()) throw new RecoveryError("NOT_READY");
      await this.command("COMPLETE", signal);
      this.file = null;
      this.identity = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
    });
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
  forgetFinished() {
    if (
      this.operation ||
      !this.view.saved?.session ||
      !["COMPLETED", "CANCELLED_PENDING"].includes(this.view.message)
    )
      return;
    try {
      clearSavedRecovery(this.dependencies.storage);
      this.file = null;
      this.identity = null;
      this.view.saved = null;
      this.view.inspection = null;
      this.view.fileName = null;
      this.view.fileMatched = false;
      this.view.uploadProgress = 0;
      this.view.message = this.view.supported ? "CHOOSE_FILE" : "UPLOAD_RECOVERY_UNSUPPORTED";
    } catch {
      this.view.message = "STORAGE_UNAVAILABLE";
    }
    this.publish();
  }
}
