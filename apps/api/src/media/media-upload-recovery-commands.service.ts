import { UploadRateLimiter } from "./upload-rate-limiter.js";
import { createHash, randomUUID } from "node:crypto";
import type { MediaUploadOperation, MediaUploadSession, Prisma } from "@ayin/db";
import type {
  AuthorizeRecoveredUploadRequest,
  CreateRecoverableDraftRequest,
  ResumeUploadRequest,
  UploadRecoveryCommandRequest,
  UploadRecoveryCommandResponse,
  UploadRecoveryOutcomeResponse,
  RecoverableUploadSession,
} from "@ayin/types";
import { Inject, Injectable } from "@nestjs/common";
import { unauthorized } from "../auth/auth.errors.js";
import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import {
  DURABLE_UPLOAD_SETTLEMENT,
  requireDurableUploadSettlement,
  readDurableUploadCapability,
  type DurableUploadSettlementProvider,
} from "./durable-upload-settlement.js";
import { lockMediaGeneration } from "./media-generation-safety.js";
import {
  assertChannelMediaOwners,
  lockChannelMediaAccounts,
  observeChannelMediaOwners,
} from "./media-privacy-account-fence.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type UploadObjectBinding,
} from "./media-storage.adapter.js";
import { uploadBindingHeaders } from "./r2-upload-completion.js";
import type { MediaStorageConfig } from "./media-storage.config.js";
import {
  assertUploadByteQuota,
  assertUploadDebtByteCapacity,
  DEFAULT_UPLOAD_DEBT_BYTE_LIMITS,
  lockUploadAccountAdmission,
  assertUploadSessionCapacity,
  conservativeMultipartExposure,
  lockUploadAdmission,
} from "./media-upload-admission.js";
import { registerUploadCleanupInTransaction } from "./media-upload-cleanup.js";
import {
  MediaUploadError,
  normalizeVideoMimeType,
  sourceExtension,
  type UploadActor,
} from "./media-upload.service.js";
import {
  authorizeRecoveredUploadSchema,
  createRecoverableDraftSchema,
  resumeUploadSchema,
  uploadRecoveryCommandSchema,
} from "./media-upload-recovery.validation.js";

// Protocol safety ceilings, separate from administrator-configurable byte quotas.
// Covers all 10,000 parts plus one replacement grant per part and recovery.
const MAX_OPERATIONS = 20_050;
const HARD_TTL_MS = 24 * 60 * 60 * 1000;
const terminal = new Set(["ABORTED", "REVOKED", "EXPIRED"]);
type Kind = "CREATE" | "RESUME" | "AUTHORIZE" | "COMPLETE" | "CANCEL";
type Reserved = { session: MediaUploadSession; operation: MediaUploadOperation; replayed: boolean };
function error(code: string, message: string, status = 409): never {
  throw new MediaUploadError(code, message, status);
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function slug(title: string) {
  return (
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120)
      .replace(/-+$/g, "") || "video"
  );
}
function sessionDto(s: MediaUploadSession, actor: UploadActor): RecoverableUploadSession {
  return {
    protocolVersion: 1,
    actorAccountId: actor.accountId,
    channelId: s.channelId,
    sessionId: s.id,
    assetId: s.sourceAssetId,
    videoId: s.videoId,
    state: s.state,
    revision: s.revision,
    mode: s.mode,
    sizeBytes: Number(s.sizeBytes),
    mimeType: s.mimeType,
    partSizeBytes: Number(s.partSizeBytes),
    partCount:
      s.mode === "SINGLE" ? 1 : Number((s.sizeBytes + s.partSizeBytes - 1n) / s.partSizeBytes),
    expiresAt: s.hardExpiresAt.toISOString(),
  };
}
function response(actor: UploadActor, value: Reserved): UploadRecoveryOutcomeResponse {
  return {
    session: sessionDto(value.session, actor),
    operation: {
      requestId: value.operation.requestId,
      status:
        value.operation.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : value.operation.status === "RESERVED"
            ? "PENDING"
            : "UNKNOWN",
      replayed: value.replayed,
    },
    ...(value.session.cleanupRequestedAt
      ? { cleanup: { authorityRevoked: true as const, settlement: "PENDING" as const } }
      : {}),
  };
}

/** Creator-only, dormant durable protocol. Legacy V1 tokens never enter this service. */
@Injectable()
export class MediaUploadRecoveryCommandsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(UploadRateLimiter) private readonly rateLimiter: UploadRateLimiter,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
    @Inject(DURABLE_UPLOAD_SETTLEMENT) private readonly settlement: DurableUploadSettlementProvider,
    @Inject(MediaProcessingLifecycleService)
    private readonly lifecycle: MediaProcessingLifecycleService,
  ) {}
  private gate(session?: MediaUploadSession) {
    const version = requireDurableUploadSettlement(
      this.settlement,
      this.storage,
      new Date(),
      this.v2AdmissionEnabled(),
    );
    if (session && session.sourceProtocolVersion !== version)
      error("UPLOAD_RECOVERY_UNSUPPORTED", "This upload protocol is not currently enabled.", 503);
    return version;
  }

  private v2AdmissionEnabled() {
    const limits = this.debtByteLimits();
    return (
      this.config.recoveryV2Enabled === true &&
      Number.isSafeInteger(limits.account) &&
      limits.account > 0 &&
      Number.isSafeInteger(limits.channel) &&
      limits.channel > 0
    );
  }

  private debtByteLimits() {
    return {
      account: this.config.recoveryDebtAccountBytes ?? DEFAULT_UPLOAD_DEBT_BYTE_LIMITS.account,
      channel: this.config.recoveryDebtChannelBytes ?? DEFAULT_UPLOAD_DEBT_BYTE_LIMITS.channel,
    };
  }

  capability() {
    return readDurableUploadCapability(
      this.settlement,
      this.storage,
      new Date(),
      this.v2AdmissionEnabled(),
    );
  }

  async creationOutcome(
    actor: UploadActor,
    requestId: string,
  ): Promise<UploadRecoveryOutcomeResponse> {
    this.rateLimiter.consume(`recovery-outcome:${actor.accountId}`);
    return this.transaction(async (tx) => {
      // Lookup is scoped to the initiating account before any resource can be
      // disclosed. Absence is not proof a lost request cannot still commit.
      const observed = await tx.mediaUploadSession.findUnique({
        where: {
          initiatingAccountId_creationRequestId: {
            initiatingAccountId: actor.accountId,
            creationRequestId: requestId,
          },
        },
      });
      if (!observed)
        error("UPLOAD_RECOVERY_NOT_FOUND", "No current saved upload outcome could be found.", 404);
      const session = await this.lockSession(tx, actor, observed.id, true, true);
      const operation = await tx.mediaUploadOperation.findUnique({
        where: { sessionId_requestId: { sessionId: session.id, requestId } },
      });
      if (
        !operation ||
        operation.kind !== "CREATE" ||
        operation.requestDigest !== session.creationRequestDigest
      )
        error("UPLOAD_RECOVERY_NOT_FOUND", "No current saved upload outcome could be found.", 404);
      return response(actor, { session, operation, replayed: true });
    });
  }

  async operationOutcome(
    actor: UploadActor,
    sessionId: string,
    requestId: string,
  ): Promise<UploadRecoveryOutcomeResponse> {
    return this.transaction(async (tx) => {
      const session = await this.lockSession(tx, actor, sessionId, true, true);
      const operation = await tx.mediaUploadOperation.findUnique({
        where: { sessionId_requestId: { sessionId, requestId } },
      });
      if (!operation)
        error("UPLOAD_RECOVERY_NOT_FOUND", "No current saved upload outcome could be found.", 404);
      return response(actor, { session, operation, replayed: true });
    });
  }

  async createDraft(
    actor: UploadActor,
    raw: CreateRecoverableDraftRequest,
  ): Promise<UploadRecoveryCommandResponse> {
    // The default-off V2 switch and protocol gate precede every reservation.
    // Legacy synthetic/provider V1 evidence preserves the historical path only.
    const sourceProtocolVersion = this.gate();
    const parsed = createRecoverableDraftSchema.safeParse(raw);
    if (!parsed.success)
      error("INVALID_RECOVERABLE_DRAFT", "Check the recoverable upload request.", 400);
    const input = parsed.data;
    this.rateLimiter.consume(`recovery-create:${actor.accountId}`);
    const title = input.title.replace(/\s+/g, " ");
    const mimeType = normalizeVideoMimeType(input.mimeType);
    if (!mimeType) error("UNSUPPORTED_VIDEO_TYPE", "Choose a supported video file.", 400);
    const bodyDigest = digest(input);
    const [maximum, quota, clipsEnabled, clipsMaximum] = await Promise.all([
      this.settings.get("uploadMaxSizeBytes"),
      this.settings.get("uploadChannelQuotaBytes"),
      this.settings.get("clipsEnabled"),
      this.settings.get("clipsMaxDurationMs"),
    ]);
    const reserved = await this.transaction(async (tx) => {
      const previousHint = await tx.mediaUploadSession.findUnique({
        where: {
          initiatingAccountId_creationRequestId: {
            initiatingAccountId: actor.accountId,
            creationRequestId: input.requestId,
          },
        },
      });
      await this.authority(tx, actor, previousHint?.channelId ?? input.channelId);
      await lockUploadAccountAdmission(tx, [actor.accountId]);
      await lockUploadAdmission(tx, input.channelId);
      const previous = await tx.mediaUploadSession.findUnique({
        where: {
          initiatingAccountId_creationRequestId: {
            initiatingAccountId: actor.accountId,
            creationRequestId: input.requestId,
          },
        },
      });
      if (previous) {
        if (previous.creationRequestDigest !== bodyDigest)
          error(
            "UPLOAD_REQUEST_CONFLICT",
            "This request ID was already used for different upload details.",
          );
        const current = await this.lockSession(tx, actor, previous.id, true);
        const operation = await tx.mediaUploadOperation.findUniqueOrThrow({
          where: { sessionId_requestId: { sessionId: current.id, requestId: input.requestId } },
        });
        return { session: current, operation, replayed: true };
      }
      if (input.sizeBytes > Number(maximum))
        error("VIDEO_TOO_LARGE", "This video exceeds the upload limit.", 413);
      if (Math.ceil(input.sizeBytes / this.config.partSizeBytes) > 10_000)
        error("UPLOAD_PART_LIMIT", "This video exceeds the configured multipart capacity.", 413);
      if (input.videoForm === "CLIP" && !clipsEnabled)
        error("CLIPS_DISABLED", "AYIN Clips uploads are disabled.");
      if (input.videoForm === "CLIP" && input.durationMs && input.durationMs > Number(clipsMaximum))
        error("CLIP_TOO_LONG", "This clip exceeds the duration limit.", 400);
      await assertUploadSessionCapacity(tx, actor.accountId, input.channelId);
      // CREATE alone permits allocation, not browser bytes. Its uncertainty is
      // bounded by the separate allocation/debt count; grants reserve exposure.
      const providerExposureBytes = sourceProtocolVersion === 2 ? 0n : null;
      await assertUploadByteQuota(tx, input.channelId, input.sizeBytes, Number(quota));
      if (sourceProtocolVersion === 2)
        await assertUploadDebtByteCapacity(
          tx,
          actor.accountId,
          input.channelId,
          0n,
          this.debtByteLimits(),
        );
      await this.lockChannel(tx, input.channelId);
      await this.authority(tx, actor, input.channelId);
      if (this.gate() !== sourceProtocolVersion)
        error("UPLOAD_RECOVERY_UNSUPPORTED", "The upload protocol changed during admission.", 503);
      const now = new Date(),
        sessionId = randomUUID(),
        assetId = randomUUID(),
        videoId = randomUUID();
      const mode =
        sourceProtocolVersion === 2 || input.sizeBytes >= this.config.multipartThresholdBytes
          ? "MULTIPART"
          : "SINGLE";
      const channelSettings = await tx.channelSettings.findUnique({
        where: { channelId: input.channelId },
        select: { defaultCommentsEnabled: true, defaultVideoVisibility: true },
      });
      await tx.video.create({
        data: {
          id: videoId,
          channelId: input.channelId,
          slug: `${slug(title)}-${videoId.slice(0, 8)}`,
          title,
          status: "UPLOADING",
          visibility: channelSettings?.defaultVideoVisibility ?? "PUBLIC",
          commentsEnabled: channelSettings?.defaultCommentsEnabled ?? true,
          durationMs: input.durationMs ?? null,
          videoForm: input.videoForm,
        },
      });
      const objectKey = `channels/${input.channelId}/media/${assetId}/source.${sourceExtension(mimeType)}`;
      await tx.mediaAsset.create({
        data: {
          id: assetId,
          channelId: input.channelId,
          videoId,
          kind: "SOURCE_VIDEO",
          status: "PENDING",
          r2ObjectKey: objectKey,
          sizeBytes: BigInt(input.sizeBytes),
          mimeType,
          uploadIntegrityRequired: true,
        },
      });
      const session = await tx.mediaUploadSession.create({
        data: {
          id: sessionId,
          sourceAssetId: assetId,
          initiatingAccountId: actor.accountId,
          channelId: input.channelId,
          videoId,
          authority: "OWNER",
          mode,
          sourceProtocolVersion,
          providerExposureBytes,
          objectKey,
          sizeBytes: BigInt(input.sizeBytes),
          mimeType,
          partSizeBytes: BigInt(this.config.partSizeBytes),
          contentIdentityAlgorithm: input.fileIdentity.algorithm,
          contentIdentityDigest: input.fileIdentity.rootSha256,
          creationRequestId: input.requestId,
          creationRequestDigest: bodyDigest,
          grantlessReservationId: randomUUID(),
          state: "PREPARING",
          createdAt: now,
          hardExpiresAt: new Date(now.getTime() + HARD_TTL_MS),
        },
      });
      const operation = await tx.mediaUploadOperation.create({
        data: {
          sessionId,
          requestId: input.requestId,
          kind: "CREATE",
          requestDigest: bodyDigest,
          expectedRevision: 1,
          status: mode === "MULTIPART" ? "DISPATCHED" : "RESERVED",
          ...(mode === "MULTIPART" ? { dispatchStartedAt: now } : {}),
          ...(sourceProtocolVersion === 2 ? { providerOutcome: "UNKNOWN" } : {}),
        },
      });
      return { session, operation, replayed: false };
    });
    if (reserved.replayed) return response(actor, reserved);
    let uploadId: string | null = null;
    try {
      this.gate(reserved.session);
      if (reserved.session.mode === "MULTIPART") {
        uploadId = (
          await this.storage.createMultipartUpload({
            key: reserved.session.objectKey,
            contentType: reserved.session.mimeType,
            uploadBinding: this.objectBinding(reserved.session),
          })
        ).uploadId;
        if (typeof uploadId !== "string" || !uploadId.trim() || Buffer.byteLength(uploadId) > 1024)
          throw new Error("Invalid multipart allocation response.");
        if (reserved.session.sourceProtocolVersion === 2) {
          // Preserve the terminal provider ACK/address even if user authority
          // was revoked while CREATE was in flight. This never opens a session.
          await this.providerAcknowledged(reserved, uploadId);
          reserved.session = { ...reserved.session, providerUploadId: uploadId };
        }
      }
      return await this.finish(actor, reserved, "PREPARING", async (tx, current) => {
        const session = await tx.mediaUploadSession.update({
          where: { id: current.id },
          data: { state: "OPEN", providerUploadId: uploadId, revision: { increment: 1 } },
        });
        return session;
      });
    } catch (failure) {
      return this.unknown(actor, reserved, failure);
    }
  }

  async resume(actor: UploadActor, sessionId: string, raw: ResumeUploadRequest) {
    const parsed = resumeUploadSchema.safeParse(raw);
    if (!parsed.success) error("INVALID_UPLOAD_COMMAND", "Check the saved upload request.", 400);
    return this.transaction(async (tx) => {
      const session = await this.lockSession(tx, actor, sessionId, true);
      const reserved = await this.reserve(tx, session, "RESUME", parsed.data);
      if (reserved.replayed) return response(actor, reserved);
      this.identity(session, parsed.data.fileIdentity);
      let current = session;
      if (session.state === "PREPARING" && session.mode === "SINGLE") {
        const creation = await tx.mediaUploadOperation.findUnique({
          where: {
            sessionId_requestId: { sessionId: session.id, requestId: session.creationRequestId! },
          },
        });
        // A server-issued witness plus an undispatched CREATE journal proves
        // this exact single reservation never reached a signer/provider. Null
        // expiry alone is never that proof and cleanup still treats it unknown.
        if (
          !session.grantlessReservationId ||
          session.grantReservationCount !== 0 ||
          session.lastGrantExpiresAt !== null ||
          creation?.kind !== "CREATE" ||
          creation.status !== "RESERVED" ||
          creation.dispatchStartedAt !== null
        )
          error("UPLOAD_STATE_CHANGED", "This reservation cannot be resumed safely.");
        current = await tx.mediaUploadSession.update({
          where: { id: session.id },
          data: { state: "OPEN", revision: { increment: 1 } },
        });
        await tx.mediaUploadOperation.update({
          where: { id: creation.id },
          data: { status: "SUCCEEDED" },
        });
      } else if (session.state !== "OPEN") {
        error("UPLOAD_STATE_CHANGED", "This upload cannot resume in its current state.");
      }
      const operation = await tx.mediaUploadOperation.update({
        where: { id: reserved.operation.id },
        data: { status: "SUCCEEDED" },
      });
      return response(actor, { session: current, operation, replayed: false });
    });
  }

  async authorize(
    actor: UploadActor,
    sessionId: string,
    raw: AuthorizeRecoveredUploadRequest,
  ): Promise<UploadRecoveryCommandResponse> {
    this.gate();
    const parsed = authorizeRecoveredUploadSchema.safeParse(raw);
    if (!parsed.success)
      error("INVALID_UPLOAD_COMMAND", "Check the upload authorization request.", 400);
    const input = parsed.data;
    const quota = Number(await this.settings.get("uploadChannelQuotaBytes"));
    const reserved = await this.transaction(async (tx) => {
      const hint = await tx.mediaUploadSession.findUnique({ where: { id: sessionId } });
      if (hint?.sourceProtocolVersion === 2 && hint.initiatingAccountId === actor.accountId) {
        // Keep the authority -> admission -> generation/source/session lock order.
        await this.authority(tx, actor, hint.channelId);
        await lockUploadAccountAdmission(tx, [actor.accountId]);
        await lockUploadAdmission(tx, hint.channelId);
      }
      const current = await this.lockSession(tx, actor, sessionId, true);
      const value = await this.reserve(tx, current, "AUTHORIZE", input);
      if (value.replayed) return value;
      if (current.state !== "OPEN")
        error("UPLOAD_STATE_CHANGED", "This upload is not open for new grants.");
      if (current.sourceProtocolVersion === 2) {
        const creation = await tx.mediaUploadOperation.findUnique({
          where: {
            sessionId_requestId: { sessionId: current.id, requestId: current.creationRequestId! },
          },
        });
        if (
          current.mode !== "MULTIPART" ||
          !current.providerUploadId ||
          creation?.kind !== "CREATE" ||
          creation.providerOutcome !== "ACKNOWLEDGED" ||
          !creation.providerTerminalAt ||
          creation.providerUploadId !== current.providerUploadId
        )
          error("UPLOAD_STATE_CHANGED", "The multipart allocation is not durably acknowledged.");
      }
      const count =
        current.mode === "SINGLE"
          ? 1
          : Number((current.sizeBytes + current.partSizeBytes - 1n) / current.partSizeBytes);
      if (input.partNumber > count)
        error("INVALID_PART", "This upload part is outside the expected range.", 400);
      this.gate(current);
      // Whole-second signing clock is reserved in the DB before any signer sees
      // the address. Returned expiry must exactly match this upper bound.
      const issued = new Date(Math.floor(Date.now() / 1000) * 1000);
      const seconds = Math.min(
        this.config.uploadUrlTtlSeconds,
        Math.floor((current.hardExpiresAt.getTime() - issued.getTime()) / 1000),
      );
      if (seconds < 1) error("UPLOAD_RECOVERY_EXPIRED", "This upload has expired.", 410);
      const expires = new Date(issued.getTime() + seconds * 1000);
      let providerExposureBytes = current.providerExposureBytes;
      if (current.sourceProtocolVersion === 2) {
        providerExposureBytes = conservativeMultipartExposure(
          Number(current.sizeBytes),
          Number(current.partSizeBytes),
        );
        if (current.providerExposureBytes === null)
          error("UPLOAD_PHYSICAL_DEBT_LIMIT", "The saved upload capacity needs review.", 429);
        if (current.providerExposureBytes > providerExposureBytes)
          providerExposureBytes = current.providerExposureBytes;
        await assertUploadByteQuota(
          tx,
          current.channelId,
          current.grantReservationCount === 0 &&
            current.lastGrantExpiresAt === null &&
            current.providerExposureBytes === 0n
            ? Number(current.sizeBytes)
            : 0,
          quota,
        );
        await assertUploadDebtByteCapacity(
          tx,
          actor.accountId,
          current.channelId,
          providerExposureBytes > current.providerExposureBytes
            ? providerExposureBytes - current.providerExposureBytes
            : 0n,
          this.debtByteLimits(),
        );
      }
      const session = await tx.mediaUploadSession.update({
        where: { id: current.id },
        data: {
          providerExposureBytes,
          lastGrantExpiresAt:
            current.lastGrantExpiresAt && current.lastGrantExpiresAt > expires
              ? current.lastGrantExpiresAt
              : expires,
          grantReservationCount: { increment: 1 },
        },
      });
      const operation = await tx.mediaUploadOperation.update({
        where: { id: value.operation.id },
        data: {
          status: "DISPATCHED",
          dispatchStartedAt: new Date(),
          grantIssuedAt: issued,
          grantExpiresAt: expires,
        },
      });
      return { session, operation, replayed: false };
    });
    if (reserved.replayed) return response(actor, reserved);
    try {
      this.gate(reserved.session);
      const now = reserved.operation.grantIssuedAt!,
        expiresInSeconds = (reserved.operation.grantExpiresAt!.getTime() - now.getTime()) / 1000;
      const authorization =
        reserved.session.mode === "SINGLE"
          ? await this.storage.authorizeSinglePut({
              key: reserved.session.objectKey,
              contentType: reserved.session.mimeType,
              uploadBinding: this.objectBinding(reserved.session),
              expiresInSeconds,
              now,
            })
          : await this.storage.authorizeMultipartPart({
              key: reserved.session.objectKey,
              uploadId: reserved.session.providerUploadId!,
              partNumber: input.partNumber,
              ...(reserved.session.sourceProtocolVersion === 2
                ? {
                    expectedSizeBytes: Number(
                      reserved.session.sizeBytes -
                        reserved.session.partSizeBytes * BigInt(input.partNumber - 1) <
                        reserved.session.partSizeBytes
                        ? reserved.session.sizeBytes -
                            reserved.session.partSizeBytes * BigInt(input.partNumber - 1)
                        : reserved.session.partSizeBytes,
                    ),
                  }
                : {}),
              expiresInSeconds,
              now,
            });
      if (
        !(authorization.expiresAt instanceof Date) ||
        authorization.expiresAt.getTime() !== reserved.operation.grantExpiresAt!.getTime() ||
        typeof authorization.url !== "string" ||
        !/^https?:\/\//.test(authorization.url) ||
        authorization.url.length > 16384
      )
        throw new Error("Storage authorization did not match its reservation.");
      const result = await this.finish(actor, reserved, "OPEN", async (_tx, session) => session);
      return {
        ...result,
        grant: {
          url: authorization.url,
          method: "PUT",
          headers:
            reserved.session.mode === "SINGLE"
              ? {
                  "content-type": reserved.session.mimeType,
                  ...uploadBindingHeaders(this.objectBinding(reserved.session)),
                }
              : {},
          expiresAt: authorization.expiresAt.toISOString(),
          partNumber: input.partNumber,
        },
      };
    } catch (failure) {
      return this.unknown(actor, reserved, failure);
    }
  }

  async complete(
    actor: UploadActor,
    sessionId: string,
    raw: UploadRecoveryCommandRequest,
  ): Promise<UploadRecoveryCommandResponse> {
    this.gate();
    const parsed = uploadRecoveryCommandSchema.safeParse(raw);
    if (!parsed.success)
      error("INVALID_UPLOAD_COMMAND", "Check the upload completion request.", 400);
    const reserved = await this.transaction(async (tx) => {
      const current = await this.lockSession(tx, actor, sessionId, true);
      const value = await this.reserve(tx, current, "COMPLETE", parsed.data);
      if (value.replayed) return value;
      if (current.state !== "OPEN")
        error("UPLOAD_STATE_CHANGED", "This upload is not open for completion.");
      if (
        current.sourceProtocolVersion === 2 &&
        (current.mode !== "MULTIPART" ||
          !current.providerUploadId ||
          (await tx.mediaUploadOperation.count({
            where: {
              sessionId: current.id,
              kind: "COMPLETE",
              dispatchStartedAt: { not: null },
            },
          })) > 0)
      )
        error("UPLOAD_STATE_CHANGED", "This multipart completion cannot be dispatched again.");
      this.gate(current);
      const session = await tx.mediaUploadSession.update({
        where: { id: current.id },
        data: { state: "FINALIZING", revision: { increment: 1 } },
      });
      // Reserve possible dispatch before even observing parts: a crash in this
      // attempt is never permission to blindly replay multipart completion.
      const operation = await tx.mediaUploadOperation.update({
        where: { id: value.operation.id },
        data: {
          status: "DISPATCHED",
          dispatchStartedAt: new Date(),
          ...(current.sourceProtocolVersion === 2
            ? {
                providerOutcome: "UNKNOWN",
                providerUploadId: current.providerUploadId,
              }
            : {}),
        },
      });
      return { session, operation, replayed: false };
    });
    if (reserved.replayed) return response(actor, reserved);
    try {
      this.gate(reserved.session);
      if (reserved.session.mode === "MULTIPART") {
        const parts = await this.storage.listParts({
          key: reserved.session.objectKey,
          uploadId: reserved.session.providerUploadId!,
        });
        this.parts(reserved.session, parts);
        // Recheck authority/revision/expiry after potentially slow observation,
        // then release all database locks before provider completion.
        await this.transaction(async (tx) => {
          const current = await this.lockSession(tx, actor, sessionId);
          this.unchanged(current, reserved.session, "FINALIZING");
          this.gate(current);
        });
        await this.storage.completeMultipartUpload({
          key: reserved.session.objectKey,
          uploadId: reserved.session.providerUploadId!,
          parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
        });
        if (reserved.session.sourceProtocolVersion === 2)
          await this.providerAcknowledged(reserved, reserved.session.providerUploadId!);
      }
      if (this.storage.observeUploadCompletion) {
        const observation = await this.storage.observeUploadCompletion(
          this.completionObservation(reserved.session),
        );
        if (observation.status !== "OBJECT_VERIFIED")
          throw new Error("The reserved source completion could not be verified.");
      } else {
        // Compatibility for existing provider contracts. The shipped R2 adapter
        // always uses its identity-bound observation above; this fallback cannot
        // reconcile a lost outcome and does not grant admission to any provider.
        const metadata = await this.storage.headObject(reserved.session.objectKey);
        if (
          !Number.isSafeInteger(metadata.sizeBytes) ||
          BigInt(metadata.sizeBytes) !== reserved.session.sizeBytes ||
          (metadata.contentType &&
            normalizeVideoMimeType(metadata.contentType) !== reserved.session.mimeType)
        )
          throw new Error("Stored metadata does not match the reserved source.");
      }
      return await this.finish(actor, reserved, "FINALIZING", (tx, current) =>
        this.acceptCompletedSource(tx, current),
      );
    } catch (failure) {
      return this.unknown(actor, reserved, failure);
    }
  }

  /** Explicit reconciliation of one existing COMPLETE. Provider calls are read-only;
   * no POST/PUT/abort is replayed, and GET outcomes remain strictly observational.
   */
  async reconcileCompletion(
    actor: UploadActor,
    sessionId: string,
    requestId: string,
    expectedRevision: number,
  ): Promise<UploadRecoveryOutcomeResponse> {
    this.gate();
    const initial = await this.transaction(async (tx) => {
      const session = await this.lockSession(tx, actor, sessionId, true);
      const operation = await tx.mediaUploadOperation.findUnique({
        where: { sessionId_requestId: { sessionId, requestId } },
      });
      if (!operation || operation.kind !== "COMPLETE")
        error("UPLOAD_RECOVERY_NOT_FOUND", "No matching upload completion could be found.", 404);
      if (operation.status === "SUCCEEDED") return { session, operation, replayed: true };
      if (session.hardExpiresAt.getTime() <= Date.now())
        error("UPLOAD_RECOVERY_EXPIRED", "This saved upload has expired.", 410);
      if (session.revision !== expectedRevision)
        error("UPLOAD_RECOVERY_CHANGED", "The saved upload changed. Check it before retrying.");
      this.reconcilable(session, operation);
      return { session, operation, replayed: true };
    });
    if (initial.operation.status === "SUCCEEDED") return response(actor, initial);
    if (!this.storage.observeUploadCompletion)
      error("UPLOAD_RECOVERY_UNSUPPORTED", "Storage completion verification is unavailable.", 503);
    let verified = false;
    try {
      this.gate(initial.session);
      verified =
        (await this.storage.observeUploadCompletion(this.completionObservation(initial.session)))
          .status === "OBJECT_VERIFIED";
    } catch {
      // Provider errors, absence and mismatches retain the original obligation.
      // Never persist private provider text or infer that a write did not occur.
    }
    return this.transaction(async (tx) => {
      const current = await this.lockSession(tx, actor, sessionId);
      const operation = await tx.mediaUploadOperation.findUniqueOrThrow({
        where: { id: initial.operation.id },
      });
      if (operation.status === "SUCCEEDED")
        return response(actor, { session: current, operation, replayed: true });
      this.unchanged(current, initial.session, initial.session.state);
      this.reconcilable(current, operation);
      this.gate(current);
      if (!verified) return response(actor, { session: current, operation, replayed: true });
      const session = await this.acceptCompletedSource(tx, current);
      const done = await tx.mediaUploadOperation.update({
        where: { id: operation.id },
        data: { status: "SUCCEEDED" },
      });
      return response(actor, { session, operation: done, replayed: true });
    });
  }

  private reconcilable(session: MediaUploadSession, operation: MediaUploadOperation) {
    const revision = operation.expectedRevision + (session.state === "FINALIZING" ? 1 : 2);
    if (
      operation.kind !== "COMPLETE" ||
      !["DISPATCHED", "UNKNOWN"].includes(operation.status) ||
      !operation.dispatchStartedAt ||
      !["FINALIZING", "UNRESOLVED"].includes(session.state) ||
      session.revision !== revision ||
      session.grantsRevokedAt ||
      session.cleanupRequestedAt ||
      (session.mode === "MULTIPART" && !session.providerUploadId)
    )
      error("UPLOAD_STATE_CHANGED", "This completion cannot be reconciled in its current state.");
  }

  private objectBinding(session: MediaUploadSession): UploadObjectBinding {
    if (!session.sourceAssetId || !session.contentIdentityDigest)
      error("UPLOAD_RECOVERY_CHANGED", "The saved source identity is unavailable.");
    return {
      sessionId: session.id,
      sourceAssetId: session.sourceAssetId,
      contentIdentityDigest: session.contentIdentityDigest,
    };
  }

  private completionObservation(session: MediaUploadSession) {
    return {
      key: session.objectKey,
      uploadId: session.mode === "MULTIPART" ? session.providerUploadId : null,
      expected: {
        sizeBytes: Number(session.sizeBytes),
        contentType: session.mimeType,
        binding: this.objectBinding(session),
      },
    };
  }

  private async acceptCompletedSource(tx: Prisma.TransactionClient, current: MediaUploadSession) {
    await tx.mediaAsset.update({
      where: { id: current.sourceAssetId! },
      data: { status: "UPLOADED" },
    });
    const session = await tx.mediaUploadSession.update({
      where: { id: current.id },
      data: { state: "COMPLETED", revision: { increment: 1 }, grantsRevokedAt: new Date() },
    });
    const queued = await this.lifecycle.enqueueUploadedAssetInTransaction(
      tx,
      current.sourceAssetId!,
    );
    if (
      !queued ||
      queued.status !== "INTEGRITY_QUEUED" ||
      queued.inputIntegritySessionId !== current.id
    )
      throw new Error("Durable upload integrity enqueue was not established.");
    return session;
  }

  async cancel(actor: UploadActor, sessionId: string, raw: UploadRecoveryCommandRequest) {
    const parsed = uploadRecoveryCommandSchema.safeParse(raw);
    if (!parsed.success)
      error("INVALID_UPLOAD_COMMAND", "Check the upload cancellation request.", 400);
    return this.transaction(async (tx) => {
      const session = await this.lockSession(tx, actor, sessionId, true);
      const value = await this.reserve(tx, session, "CANCEL", parsed.data);
      if (value.replayed) return response(actor, value);
      if (session.state === "COMPLETED")
        error("UPLOAD_ALREADY_ACCEPTED", "Accepted uploads require the video removal workflow.");
      if (!terminal.has(session.state))
        await registerUploadCleanupInTransaction(tx, {
          sessionId,
          accountId: actor.accountId,
          state: "ABORTED",
          now: new Date(),
        });
      const current = await tx.mediaUploadSession.findUniqueOrThrow({ where: { id: sessionId } });
      const operation = await tx.mediaUploadOperation.update({
        where: { id: value.operation.id },
        data: { status: "SUCCEEDED" },
      });
      return response(actor, { session: current, operation, replayed: false });
    });
  }

  private async reserve(
    tx: Prisma.TransactionClient,
    session: MediaUploadSession,
    kind: Kind,
    body: UploadRecoveryCommandRequest,
  ): Promise<Reserved> {
    const requestDigest = digest({ kind, ...body });
    const previous = await tx.mediaUploadOperation.findUnique({
      where: { sessionId_requestId: { sessionId: session.id, requestId: body.requestId } },
    });
    if (previous) {
      if (previous.kind !== kind || previous.requestDigest !== requestDigest)
        error(
          "UPLOAD_REQUEST_CONFLICT",
          "This request ID was already used for a different command.",
        );
      return { session, operation: previous, replayed: true };
    }
    if (kind !== "CANCEL" && session.hardExpiresAt.getTime() <= Date.now())
      error("UPLOAD_RECOVERY_EXPIRED", "This saved upload has expired.", 410);
    if (session.revision !== body.expectedRevision)
      error("UPLOAD_RECOVERY_CHANGED", "The saved upload changed. Inspect it before retrying.");
    if (
      (await tx.mediaUploadOperation.count({ where: { sessionId: session.id } })) >=
      (kind === "CANCEL" ? MAX_OPERATIONS : MAX_OPERATIONS - 1)
    )
      error("UPLOAD_COMMAND_LIMIT", "This upload reached its recovery command limit.", 429);
    const operation = await tx.mediaUploadOperation.create({
      data: {
        sessionId: session.id,
        requestId: body.requestId,
        kind,
        requestDigest,
        expectedRevision: body.expectedRevision,
      },
    });
    return { session, operation, replayed: false };
  }
  private async finish(
    actor: UploadActor,
    reserved: Reserved,
    state: MediaUploadSession["state"],
    operation: (
      tx: Prisma.TransactionClient,
      session: MediaUploadSession,
    ) => Promise<MediaUploadSession>,
  ) {
    return this.transaction(async (tx) => {
      const current = await this.lockSession(tx, actor, reserved.session.id);
      const journal = await tx.mediaUploadOperation.findUniqueOrThrow({
        where: { id: reserved.operation.id },
      });
      if (journal.status === "SUCCEEDED")
        return response(actor, { session: current, operation: journal, replayed: true });
      this.unchanged(current, reserved.session, state);
      this.gate(current);
      if (journal.grantExpiresAt && journal.grantExpiresAt.getTime() <= Date.now())
        error(
          "UPLOAD_GRANT_EXPIRED",
          "This upload grant expired before it could be returned.",
          410,
        );
      if (!["RESERVED", "DISPATCHED"].includes(journal.status))
        error("UPLOAD_RECOVERY_CHANGED", "This operation is no longer pending.");
      const session = await operation(tx, current);
      const done = await tx.mediaUploadOperation.update({
        where: { id: journal.id },
        data: { status: "SUCCEEDED" },
      });
      return response(actor, { session, operation: done, replayed: false });
    });
  }
  /** Save provider facts independently from logical source acceptance. No
   * account/authority lock is required: revocation cannot erase an in-flight
   * CREATE's address or a COMPLETE's terminal ACK. Cleanup reads this journal.
   */
  private async providerAcknowledged(reserved: Reserved, uploadId: string) {
    await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${reserved.session.id}::uuid FOR UPDATE`;
      const journal = await tx.mediaUploadOperation.findUniqueOrThrow({
        where: { id: reserved.operation.id },
      });
      if (
        reserved.session.sourceProtocolVersion !== 2 ||
        journal.sessionId !== reserved.session.id ||
        journal.requestId !== reserved.operation.requestId ||
        journal.kind !== reserved.operation.kind ||
        journal.requestDigest !== reserved.operation.requestDigest ||
        journal.expectedRevision !== reserved.operation.expectedRevision ||
        !journal.dispatchStartedAt ||
        !["CREATE", "COMPLETE"].includes(journal.kind) ||
        (journal.providerUploadId !== null && journal.providerUploadId !== uploadId)
      )
        throw new Error("Multipart provider outcome does not match its dispatch.");
      if (journal.providerOutcome === "ACKNOWLEDGED") return;
      if (journal.providerOutcome !== "UNKNOWN")
        throw new Error("Multipart provider dispatch was not reserved.");
      await tx.mediaUploadOperation.update({
        where: { id: journal.id },
        data: {
          providerOutcome: "ACKNOWLEDGED",
          providerTerminalAt: new Date(),
          providerUploadId: uploadId,
        },
      });
      if (journal.kind === "CREATE")
        await tx.mediaUploadSession.updateMany({
          where: {
            id: reserved.session.id,
            state: "PREPARING",
            revision: reserved.session.revision,
            providerUploadId: null,
          },
          data: { providerUploadId: uploadId },
        });
    });
  }
  private async unknown(
    actor: UploadActor,
    reserved: Reserved,
    failure: unknown,
  ): Promise<UploadRecoveryCommandResponse> {
    // Source/video writes and all authority locks are intentionally absent here.
    // The CAS can only quarantine our still-current attempt; it cannot resurrect
    // a cancelled/privacy-revoked session or overwrite a committed success.
    await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${reserved.session.id}::uuid FOR UPDATE`;
      const journal = await tx.mediaUploadOperation.findUnique({
        where: { id: reserved.operation.id },
      });
      if (!journal || journal.status === "SUCCEEDED") return;
      await tx.mediaUploadSession.updateMany({
        where: {
          id: reserved.session.id,
          revision: reserved.session.revision,
          state: reserved.session.state,
        },
        data: { state: "UNRESOLVED", revision: { increment: 1 } },
      });
      await tx.mediaUploadOperation.updateMany({
        where: { id: reserved.operation.id, status: { in: ["RESERVED", "DISPATCHED"] } },
        data: {
          status: "UNKNOWN",
          dispatchStartedAt: reserved.operation.dispatchStartedAt ?? new Date(),
        },
      });
    });
    if (failure instanceof MediaUploadError) throw failure;
    return this.transaction(async (tx) => {
      const session = await this.lockSession(tx, actor, reserved.session.id, true);
      const operation = await tx.mediaUploadOperation.findUniqueOrThrow({
        where: { id: reserved.operation.id },
      });
      return response(actor, { session, operation, replayed: false });
    });
  }
  private unchanged(
    current: MediaUploadSession,
    expected: MediaUploadSession,
    state: MediaUploadSession["state"],
  ) {
    if (
      current.revision !== expected.revision ||
      current.state !== state ||
      current.objectKey !== expected.objectKey ||
      current.sourceAssetId !== expected.sourceAssetId ||
      current.providerUploadId !== expected.providerUploadId ||
      current.contentIdentityDigest !== expected.contentIdentityDigest
    )
      error("UPLOAD_RECOVERY_CHANGED", "The saved upload changed during this operation.");
  }
  private identity(session: MediaUploadSession, identity: ResumeUploadRequest["fileIdentity"]) {
    if (
      BigInt(identity.sizeBytes) !== session.sizeBytes ||
      identity.algorithm !== session.contentIdentityAlgorithm ||
      identity.rootSha256 !== session.contentIdentityDigest
    )
      error("UPLOAD_FILE_CHANGED", "Select the original file to resume this upload.");
  }
  private parts(session: MediaUploadSession, parts: ExistingUploadPart[]) {
    const count = Number((session.sizeBytes + session.partSizeBytes - 1n) / session.partSizeBytes);
    if (!Array.isArray(parts) || parts.length !== count)
      throw new Error("Incomplete multipart observation.");
    for (let index = 0; index < count; index++) {
      const part = parts[index];
      const expected =
        index === count - 1
          ? session.sizeBytes - session.partSizeBytes * BigInt(index)
          : session.partSizeBytes;
      if (
        !part ||
        part.partNumber !== index + 1 ||
        !Number.isSafeInteger(part.sizeBytes) ||
        BigInt(part.sizeBytes) !== expected ||
        typeof part.etag !== "string" ||
        !part.etag.trim() ||
        Buffer.byteLength(part.etag) > 256
      )
        throw new Error("Invalid multipart observation.");
    }
  }
  private async authority(tx: Prisma.TransactionClient, actor: UploadActor, channelId: string) {
    const owners = await observeChannelMediaOwners(tx, channelId);
    await lockChannelMediaAccounts(tx, actor.accountId, owners);
    const account = await tx.account.findUnique({
      where: { id: actor.accountId },
      select: { status: true, authVersion: true },
    });
    const sessions = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "AccountSession" WHERE id=${actor.sessionId}::uuid AND "accountId"=${actor.accountId}::uuid AND "authVersion"=${actor.authVersion} AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
    if (
      !account ||
      account.status !== "ACTIVE" ||
      account.authVersion !== actor.authVersion ||
      !sessions.length
    )
      throw unauthorized();
    await assertChannelMediaOwners(tx, channelId, owners);
    if (!owners.includes(actor.accountId))
      error(
        "CHANNEL_OWNER_REQUIRED",
        "Current channel ownership is required to manage this upload.",
        403,
      );
    // Any owner already in deletion blocks admission, even if the actor remains active.
    const inactive = await tx.account.count({
      where: { id: { in: owners }, status: { not: "ACTIVE" } },
    });
    if (inactive) error("UPLOAD_RECOVERY_CHANGED", "The upload owner is no longer available.");
  }
  private async lockChannel(tx: Prisma.TransactionClient, channelId: string) {
    const [channel] = await tx.$queryRaw<
      Array<{ status: string; removedAt: Date | null }>
    >`SELECT status, "removedAt" FROM "Channel" WHERE id=${channelId}::uuid FOR SHARE`;
    if (!channel || channel.status === "REMOVED" || channel.removedAt)
      error("UPLOAD_RECOVERY_CHANGED", "The channel is no longer available.");
  }
  private async lockSession(
    tx: Prisma.TransactionClient,
    actor: UploadActor,
    id: string,
    allowExpired = false,
    readOnly = false,
  ) {
    const observed = await tx.mediaUploadSession.findUnique({ where: { id } });
    if (
      !observed ||
      observed.initiatingAccountId !== actor.accountId ||
      observed.authority !== "OWNER" ||
      !observed.creationRequestId
    )
      error("UPLOAD_RECOVERY_NOT_FOUND", "The saved creator upload could not be found.", 404);
    await this.authority(tx, actor, observed.channelId);
    if (!observed.sourceAssetId || !observed.videoId)
      error("UPLOAD_RECOVERY_CHANGED", "The saved upload is no longer available.");
    await lockMediaGeneration(tx, observed.videoId);
    if (readOnly)
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${observed.sourceAssetId}::uuid FOR SHARE /* ayin-recovery-outcome-source-lock */`;
    else
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${observed.sourceAssetId}::uuid FOR UPDATE /* ayin-recovery-command-source-lock */`;
    const asset = await tx.mediaAsset.findUnique({ where: { id: observed.sourceAssetId } });
    const videos = readOnly
      ? await tx.$queryRaw<
          Array<{ channelId: string; status: string; removedAt: Date | null }>
        >`SELECT "channelId", status, "removedAt" FROM "Video" WHERE id=${observed.videoId}::uuid FOR SHARE /* ayin-recovery-outcome-video-lock */`
      : await tx.$queryRaw<
          Array<{ channelId: string; status: string; removedAt: Date | null }>
        >`SELECT "channelId", status, "removedAt" FROM "Video" WHERE id=${observed.videoId}::uuid FOR NO KEY UPDATE /* ayin-recovery-command-video-lock */`;
    const [video] = videos;
    if (
      !video ||
      video.channelId !== observed.channelId ||
      video.status === "REMOVED" ||
      video.removedAt
    )
      error("UPLOAD_RECOVERY_CHANGED", "The saved video is no longer available.");
    await this.lockChannel(tx, observed.channelId);
    if (readOnly)
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${id}::uuid FOR SHARE /* ayin-recovery-outcome-session-lock */`;
    else
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${id}::uuid FOR UPDATE /* ayin-recovery-command-session-lock */`;
    const current = await tx.mediaUploadSession.findUniqueOrThrow({ where: { id } });
    if (
      current.initiatingAccountId !== actor.accountId ||
      current.authority !== "OWNER" ||
      current.channelId !== observed.channelId ||
      current.videoId !== observed.videoId ||
      current.sourceAssetId !== observed.sourceAssetId ||
      current.objectKey !== observed.objectKey
    )
      error("UPLOAD_RECOVERY_CHANGED", "The saved upload changed while waiting.");
    if (
      !asset ||
      asset.videoId !== current.videoId ||
      asset.channelId !== current.channelId ||
      asset.kind !== "SOURCE_VIDEO" ||
      !asset.uploadIntegrityRequired ||
      asset.r2ObjectKey !== current.objectKey ||
      asset.sizeBytes !== current.sizeBytes ||
      asset.mimeType !== current.mimeType ||
      (!terminal.has(current.state) &&
        current.state !== "COMPLETED" &&
        (asset.removedAt || !["PENDING", "UPLOADED"].includes(asset.status)))
    )
      error("UPLOAD_RECOVERY_CHANGED", "The saved source changed.");
    await this.authority(tx, actor, current.channelId);
    if (!allowExpired && current.hardExpiresAt.getTime() <= Date.now())
      error("UPLOAD_RECOVERY_EXPIRED", "This saved upload has expired.", 410);
    return current;
  }
  private transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
        return operation(tx);
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }
}
