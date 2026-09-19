import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { CreatorComplianceService } from "./creator-compliance.service.js";
import { decryptPayoutDestination, encryptPayoutDestination } from "./creator-finance.crypto.js";
import {
  EXTERNAL_PAYOUT_PROVIDER_ADAPTER,
  ExternalPayoutProviderError,
  type ExternalPayoutProviderAdapter,
  type NormalizedProviderTransferState,
} from "./external-payout-provider.adapter.js";
import { parseMoneyMicros } from "./money.js";
import {
  assertProviderTransferTransition,
  buildPayoutProviderIdempotencyKey,
  canRetryProviderSubmission,
  isTerminalProviderTransferState,
  MAX_PROVIDER_SUBMIT_ATTEMPTS,
  providerSubmitRetryDelayMs,
  STALE_SUBMISSION_MS,
  type ProviderTransferState,
} from "./payout-provider-state-machine.js";
import {
  providerActionReasonSchema,
  verifyProviderDestinationSchema,
} from "./payout-provider.schemas.js";
import { RevenueService } from "./revenue.service.js";

const PAYOUT_ELIGIBLE_STATES = new Set(["FINAL", "ADJUSTMENT"]);
const PAYOUT_ELIGIBLE_TYPES = new Set(["AD_REVENUE", "ADJUSTMENT"]);

@Injectable()
export class PayoutProviderTransferService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RevenueService) private readonly revenue: RevenueService,
    @Inject(EXTERNAL_PAYOUT_PROVIDER_ADAPTER)
    private readonly provider: ExternalPayoutProviderAdapter,
    @Inject(CreatorComplianceService)
    private readonly compliance: CreatorComplianceService,
  ) {}

  capabilities() {
    return {
      ...this.provider.capabilities(),
      retryPolicy: {
        maxSubmissionAttempts: MAX_PROVIDER_SUBMIT_ATTEMPTS,
        baseDelaySeconds: providerSubmitRetryDelayMs(1) / 1000,
        maxDelaySeconds: providerSubmitRetryDelayMs(MAX_PROVIDER_SUBMIT_ATTEMPTS) / 1000,
        sameIdempotencyKeyAcrossRetries: true,
      },
      paidConfirmation: "STATUS_OR_VERIFIED_WEBHOOK_ONLY" as const,
      rawBankSecretsSentByThisAdapter: false,
    };
  }

  async getTransfer(payoutId: string) {
    const payout = await this.database.client.payout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { providerTransfer: true },
    });
    return {
      payout: {
        id: payout.id,
        provider: payout.provider,
        status: payout.status,
        amount: String(payout.amount),
        currency: payout.currency,
        externalReference: payout.externalReference,
      },
      transfer: payout.providerTransfer
        ? {
            ...payout.providerTransfer,
            idempotencyKey: this.maskIdempotencyKey(payout.providerTransfer.idempotencyKey),
          }
        : null,
      capabilities: this.capabilities(),
    };
  }

  async submit(actorAccountId: string, payoutId: string, raw: unknown = {}) {
    const input = providerActionReasonSchema.parse(raw);
    const capabilities = this.assertProviderReady();
    if (!capabilities.idempotentSubmission) {
      throw new Error("PAYOUT_PROVIDER_IDEMPOTENCY_NOT_GUARANTEED");
    }
    if (!capabilities.supportsDestinationTokenization) {
      throw new Error("PAYOUT_PROVIDER_TOKENIZATION_REQUIRED");
    }

    const payoutContext = await this.database.client.payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { channelId: true },
    });
    await this.compliance.assertPayoutEligible(payoutContext.channelId);

    const settings = await this.revenue.getSettings();
    const thresholdMicros = BigInt(settings.payoutThresholdMicros);
    const now = new Date();

    const claimed = await this.database.client.$transaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
        include: {
          providerTransfer: true,
          ledgerEntries: {
            select: { id: true, state: true, type: true, amount: true, payoutId: true },
          },
        },
      });
      this.assertPayoutMatchesProvider(payout.provider);
      this.assertPayoutFunding(payout, thresholdMicros);
      if (!payout.providerDestinationTokenEncryptedSnapshot) {
        throw new Error("PAYOUT_PROVIDER_DESTINATION_NOT_VERIFIED");
      }
      if (payout.status !== "PENDING" && payout.status !== "PROCESSING") {
        throw new Error("PAYOUT_NOT_SUBMITTABLE");
      }

      let transfer =
        payout.providerTransfer ??
        (await tx.payoutProviderTransfer.upsert({
          where: { payoutId: payout.id },
          create: {
            payoutId: payout.id,
            provider: this.provider.kind,
            idempotencyKey: buildPayoutProviderIdempotencyKey(this.provider.kind, payout.id),
            state: "READY",
          },
          update: {},
        }));

      if (
        transfer.state === "SUBMITTING" &&
        now.getTime() - transfer.updatedAt.getTime() >= STALE_SUBMISSION_MS
      ) {
        transfer = await tx.payoutProviderTransfer.update({
          where: { id: transfer.id },
          data: {
            state: "SUBMISSION_UNKNOWN",
            lastErrorCode: "STALE_SUBMISSION_RECOVERY",
            lastErrorMessage:
              "A submission attempt did not persist a provider response; retry must reuse the same idempotency key.",
            nextRetryAt: now,
          },
        });
      }

      if (isTerminalProviderTransferState(transfer.state as ProviderTransferState)) {
        throw new Error("PAYOUT_PROVIDER_TRANSFER_TERMINAL");
      }
      if (
        transfer.state === "SUBMISSION_UNKNOWN" &&
        !canRetryProviderSubmission({
          state: "SUBMISSION_UNKNOWN",
          submitAttempts: transfer.submitAttempts,
          nextRetryAt: transfer.nextRetryAt,
          now,
        })
      ) {
        throw new Error(
          transfer.submitAttempts >= MAX_PROVIDER_SUBMIT_ATTEMPTS
            ? "PAYOUT_PROVIDER_RETRY_EXHAUSTED"
            : "PAYOUT_PROVIDER_RETRY_NOT_DUE",
        );
      }
      if (transfer.state !== "READY" && transfer.state !== "SUBMISSION_UNKNOWN") {
        throw new Error("PAYOUT_PROVIDER_SUBMISSION_IN_PROGRESS");
      }

      const claimedRow = await tx.payoutProviderTransfer.updateMany({
        where: { id: transfer.id, state: transfer.state },
        data: {
          state: "SUBMITTING",
          submitAttempts: { increment: 1 },
          nextRetryAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (claimedRow.count !== 1) throw new Error("PAYOUT_PROVIDER_SUBMISSION_IN_PROGRESS");

      const updated = await tx.payoutProviderTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "payout.provider_submission_started",
          entityType: "Payout",
          entityId: payout.id,
          reason: input.reason,
          metadata: {
            provider: this.provider.kind,
            transferId: updated.id,
            attempt: updated.submitAttempts,
            idempotencyKeyFingerprint: this.maskIdempotencyKey(updated.idempotencyKey),
          },
        },
      });
      return { payout, transfer: updated };
    });

    const destinationToken = decryptPayoutDestination(
      claimed.payout.providerDestinationTokenEncryptedSnapshot!,
    );

    try {
      const result = await this.provider.submitTransfer({
        payoutId: claimed.payout.id,
        amount: String(claimed.payout.amount),
        currency: claimed.payout.currency,
        idempotencyKey: claimed.transfer.idempotencyKey,
        destinationToken,
        legalName: claimed.payout.legalNameSnapshot ?? "",
        countryCode: claimed.payout.countryCodeSnapshot,
      });
      if (!result.externalTransferId.trim())
        throw new Error("PAYOUT_PROVIDER_TRANSFER_ID_REQUIRED");

      return this.database.client.$transaction(async (tx) => {
        const current = await tx.payoutProviderTransfer.findUniqueOrThrow({
          where: { id: claimed.transfer.id },
        });
        const nextState: ProviderTransferState =
          result.state === "PROCESSING" ? "PROCESSING" : "SUBMITTED";
        assertProviderTransferTransition(current.state as ProviderTransferState, nextState);

        const transfer = await tx.payoutProviderTransfer.update({
          where: { id: current.id },
          data: {
            state: nextState,
            externalTransferId: result.externalTransferId,
            providerResponseState: result.providerState.slice(0, 120),
            submittedAt: current.submittedAt ?? new Date(),
            lastCheckedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        const payout = await tx.payout.update({
          where: { id: claimed.payout.id },
          data: {
            status: "PROCESSING",
            processedAt: claimed.payout.processedAt ?? new Date(),
            externalReference: result.externalTransferId,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorAccountId,
            action: "payout.provider_submission_acknowledged",
            entityType: "Payout",
            entityId: payout.id,
            reason: input.reason,
            metadata: {
              provider: this.provider.kind,
              transferId: transfer.id,
              externalTransferId: result.externalTransferId,
              providerState: result.providerState,
              payoutStatus: "PROCESSING",
              paid: false,
            },
          },
        });
        return this.safeResult(payout, transfer);
      });
    } catch (error) {
      await this.recordSubmissionFailure(
        actorAccountId,
        claimed.payout.id,
        claimed.transfer.id,
        error,
      );
      throw error;
    }
  }

  async refresh(actorAccountId: string, payoutId: string, raw: unknown = {}) {
    const input = providerActionReasonSchema.parse(raw);
    this.assertProviderReady();
    const transfer = await this.database.client.payoutProviderTransfer.findUniqueOrThrow({
      where: { payoutId },
      include: { payout: true },
    });
    this.assertPayoutMatchesProvider(transfer.payout.provider);
    if (!transfer.externalTransferId) {
      throw new Error("PAYOUT_PROVIDER_EXTERNAL_TRANSFER_ID_MISSING");
    }
    if (isTerminalProviderTransferState(transfer.state as ProviderTransferState)) {
      return this.safeResult(transfer.payout, transfer);
    }

    const result = await this.provider.retrieveTransferStatus(transfer.externalTransferId);
    return this.applyProviderStatus({
      actorAccountId,
      transferId: transfer.id,
      providerState: result.providerState,
      state: result.state,
      source: "STATUS_CHECK",
      reason: input.reason,
      incrementStatusAttempts: true,
    });
  }

  async cancel(actorAccountId: string, payoutId: string, raw: unknown = {}) {
    const input = providerActionReasonSchema.parse(raw);
    const payout = await this.database.client.payout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { providerTransfer: true },
    });

    if (!payout.providerTransfer || payout.providerTransfer.state === "READY") {
      if (payout.status !== "PENDING") throw new Error("PAYOUT_PROVIDER_CANCEL_NOT_ALLOWED");
      return this.database.client.$transaction(async (tx) => {
        if (payout.providerTransfer) {
          await tx.payoutProviderTransfer.update({
            where: { id: payout.providerTransfer.id },
            data: { state: "CANCELLED", cancelledAt: new Date() },
          });
        }
        const cancelled = await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: "CANCELLED",
            processedAt: payout.processedAt ?? new Date(),
            failureReason: "Cancelled before external provider submission.",
          },
        });
        await tx.earningsLedgerEntry.updateMany({
          where: { payoutId: payout.id },
          data: { payoutId: null },
        });
        await tx.adminAuditLog.create({
          data: {
            actorAccountId,
            action: "payout.provider_cancelled_before_submission",
            entityType: "Payout",
            entityId: payout.id,
            reason: input.reason,
            metadata: { provider: payout.provider, externalTransferCreated: false },
          },
        });
        return { payout: { ...cancelled, amount: String(cancelled.amount) }, transfer: null };
      });
    }

    const capabilities = this.assertProviderReady();
    this.assertPayoutMatchesProvider(payout.provider);
    const transfer = payout.providerTransfer;
    if (transfer.state === "COMPLETED") throw new Error("PAYOUT_ALREADY_PAID");
    if (transfer.state === "FAILED" || transfer.state === "CANCELLED") {
      return this.safeResult(payout, transfer);
    }
    if (!transfer.externalTransferId) {
      throw new Error("PAYOUT_PROVIDER_SUBMISSION_UNCERTAIN");
    }
    if (!capabilities.supportsCancellation) {
      throw new Error("PAYOUT_PROVIDER_CANCELLATION_UNSUPPORTED");
    }

    const result = await this.provider.cancelTransfer(transfer.externalTransferId);
    if (result.state === "CANCELLED") {
      return this.applyProviderStatus({
        actorAccountId,
        transferId: transfer.id,
        providerState: result.providerState,
        state: "CANCELLED",
        source: "CANCEL_RESPONSE",
        reason: input.reason,
        incrementCancelAttempts: true,
      });
    }

    return this.database.client.$transaction(async (tx) => {
      const current = await tx.payoutProviderTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      assertProviderTransferTransition(current.state as ProviderTransferState, "CANCEL_REQUESTED");
      const updated = await tx.payoutProviderTransfer.update({
        where: { id: current.id },
        data: {
          state: "CANCEL_REQUESTED",
          providerResponseState: result.providerState.slice(0, 120),
          cancelAttempts: { increment: 1 },
          lastCheckedAt: new Date(),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "payout.provider_cancel_requested",
          entityType: "Payout",
          entityId: payout.id,
          reason: input.reason,
          metadata: {
            provider: this.provider.kind,
            transferId: updated.id,
            externalTransferId: transfer.externalTransferId,
            providerState: result.providerState,
          },
        },
      });
      return this.safeResult(payout, updated);
    });
  }

  async verifyDestination(actorAccountId: string, profileId: string, raw: unknown) {
    const input = verifyProviderDestinationSchema.parse(raw);
    const capabilities = this.assertProviderReady();
    if (!capabilities.supportsDestinationTokenization) {
      throw new Error("PAYOUT_PROVIDER_TOKENIZATION_REQUIRED");
    }
    const profile = await this.database.client.creatorPayoutProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    this.assertPayoutMatchesProvider(profile.provider);

    const result = await this.provider.verifyDestination({
      destinationToken: input.destinationToken,
      currency: profile.preferredCurrency,
      legalName: profile.legalName,
      countryCode: profile.countryCode,
    });
    if (!result.verified) throw new Error("PAYOUT_PROVIDER_DESTINATION_NOT_VERIFIED");
    const destinationMask = result.destinationMask ?? profile.destinationMask;
    if (!destinationMask) throw new Error("PAYOUT_PROVIDER_DESTINATION_MASK_REQUIRED");

    const updated = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.creatorPayoutProfile.update({
        where: { id: profile.id },
        data: {
          providerDestinationTokenEncrypted: encryptPayoutDestination(input.destinationToken),
          providerDestinationVerifiedAt: new Date(),
          payoutDestinationStatus: "VERIFIED",
          destinationMask,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "payout.provider_destination_verified",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          metadata: {
            provider: this.provider.kind,
            providerState: result.providerState,
            destinationMask,
            tokenStoredEncrypted: true,
            rawDestinationStored: false,
            payoutDestinationStatus: "VERIFIED",
          },
        },
      });
      return saved;
    });

    return {
      profileId: updated.id,
      provider: updated.provider,
      destinationMask: updated.destinationMask,
      verifiedAt: updated.providerDestinationVerifiedAt,
    };
  }

  async processWebhook(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    rawBody: Buffer,
  ) {
    const capabilities = this.assertProviderReady();
    if (capabilities.webhookVerification !== "CRYPTOGRAPHIC") {
      throw new Error("PAYOUT_PROVIDER_WEBHOOK_CRYPTO_REQUIRED");
    }
    if (!rawBody.length) throw new Error("PAYOUT_PROVIDER_WEBHOOK_RAW_BODY_REQUIRED");

    const event = await this.provider.verifyWebhook(headers, rawBody);
    if (!event.verified) throw new Error("PAYOUT_PROVIDER_WEBHOOK_SIGNATURE_INVALID");
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");

    const existing = await this.database.client.payoutProviderEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: this.provider.kind,
          externalEventId: event.externalEventId,
        },
      },
    });
    if (existing) return { accepted: true, duplicate: true, eventId: existing.id };

    const transfer = await this.database.client.payoutProviderTransfer.findUnique({
      where: {
        provider_externalTransferId: {
          provider: this.provider.kind,
          externalTransferId: event.externalTransferId,
        },
      },
      include: { payout: true },
    });

    if (!transfer) {
      const stored = await this.database.client.$transaction(async (tx) => {
        const row = await tx.payoutProviderEvent.create({
          data: {
            transferId: null,
            provider: this.provider.kind,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            providerState: event.providerState.slice(0, 120),
            verified: true,
            payloadSha256,
            processedAt: new Date(),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorAccountId: null,
            action: "payout.provider_webhook_unmatched",
            entityType: "PayoutProviderEvent",
            entityId: row.id,
            metadata: {
              provider: this.provider.kind,
              externalEventId: event.externalEventId,
              externalTransferId: event.externalTransferId,
              payloadSha256,
              signatureVerified: true,
            },
          },
        });
        return row;
      });
      return { accepted: true, duplicate: false, matched: false, eventId: stored.id };
    }

    const outcome = await this.applyProviderStatus({
      actorAccountId: null,
      transferId: transfer.id,
      providerState: event.providerState,
      state: event.state,
      source: "VERIFIED_WEBHOOK",
      reason: `Verified provider webhook: ${event.eventType}`,
      externalEvent: {
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        payloadSha256,
      },
    });
    return { accepted: true, duplicate: false, matched: true, ...outcome };
  }

  private assertProviderReady() {
    const capabilities = this.provider.capabilities();
    if (!capabilities.connected || !capabilities.productionEnabled) {
      throw new Error("PAYOUT_PROVIDER_NOT_CONFIGURED");
    }
    return capabilities;
  }

  private assertPayoutMatchesProvider(provider: string) {
    if (provider !== this.provider.kind) throw new Error("PAYOUT_PROVIDER_MISMATCH");
  }

  private assertPayoutFunding(
    payout: {
      amount: unknown;
      currency: string;
      ledgerEntries: Array<{
        state: string;
        type: string;
        amount: unknown;
        payoutId: string | null;
      }>;
    },
    thresholdMicros: bigint,
  ) {
    if (!/^[A-Z]{3}$/.test(payout.currency)) throw new Error("PAYOUT_CURRENCY_INVALID");
    const payoutMicros = parseMoneyMicros(String(payout.amount));
    if (payoutMicros <= 0n) throw new Error("PAYOUT_AMOUNT_INVALID");
    if (payoutMicros < thresholdMicros) throw new Error("PAYOUT_THRESHOLD_NOT_MET");
    if (!payout.ledgerEntries.length) throw new Error("PAYOUT_LEDGER_RESERVATION_MISSING");

    let reservedMicros = 0n;
    for (const entry of payout.ledgerEntries) {
      if (
        entry.payoutId === null ||
        !PAYOUT_ELIGIBLE_STATES.has(entry.state) ||
        !PAYOUT_ELIGIBLE_TYPES.has(entry.type)
      ) {
        throw new Error("PAYOUT_LEDGER_NOT_FINALIZED");
      }
      reservedMicros += parseMoneyMicros(String(entry.amount));
    }
    if (reservedMicros !== payoutMicros) throw new Error("PAYOUT_LEDGER_AMOUNT_MISMATCH");
  }

  private async recordSubmissionFailure(
    actorAccountId: string,
    payoutId: string,
    transferId: string,
    error: unknown,
  ) {
    const providerError =
      error instanceof ExternalPayoutProviderError
        ? error
        : new ExternalPayoutProviderError(
            "PAYOUT_PROVIDER_SUBMISSION_UNKNOWN",
            true,
            true,
            error instanceof Error ? error.message : "Unknown provider submission failure.",
          );

    await this.database.client.$transaction(async (tx) => {
      const transfer = await tx.payoutProviderTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
      if (transfer.state !== "SUBMITTING") return;

      const definitiveFailure =
        !providerError.retryable && providerError.submissionMayHaveSucceeded === false;
      const nextState: ProviderTransferState = definitiveFailure ? "FAILED" : "SUBMISSION_UNKNOWN";
      assertProviderTransferTransition("SUBMITTING", nextState);
      const nextRetryAt =
        !definitiveFailure &&
        providerError.retryable &&
        transfer.submitAttempts < MAX_PROVIDER_SUBMIT_ATTEMPTS
          ? new Date(Date.now() + providerSubmitRetryDelayMs(transfer.submitAttempts))
          : null;

      await tx.payoutProviderTransfer.update({
        where: { id: transfer.id },
        data: {
          state: nextState,
          nextRetryAt,
          lastErrorCode: providerError.code.slice(0, 160),
          lastErrorMessage: providerError.message.slice(0, 1000),
        },
      });
      if (definitiveFailure) {
        await tx.payout.update({
          where: { id: payoutId },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            failureReason: providerError.code,
          },
        });
        await tx.earningsLedgerEntry.updateMany({
          where: { payoutId },
          data: { payoutId: null },
        });
      } else {
        await tx.payout.update({
          where: { id: payoutId },
          data: { status: "PROCESSING", processedAt: new Date() },
        });
      }
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "payout.provider_submission_failed",
          entityType: "Payout",
          entityId: payoutId,
          metadata: {
            provider: this.provider.kind,
            transferId,
            code: providerError.code,
            retryable: providerError.retryable,
            submissionMayHaveSucceeded: providerError.submissionMayHaveSucceeded,
            nextRetryAt: nextRetryAt?.toISOString() ?? null,
            ledgerReleased: definitiveFailure,
          },
        },
      });
    });
  }

  private async applyProviderStatus(input: {
    actorAccountId: string | null;
    transferId: string;
    providerState: string;
    state: NormalizedProviderTransferState;
    source: "STATUS_CHECK" | "CANCEL_RESPONSE" | "VERIFIED_WEBHOOK";
    reason: string;
    incrementStatusAttempts?: boolean;
    incrementCancelAttempts?: boolean;
    externalEvent?: {
      externalEventId: string;
      eventType: string;
      payloadSha256: string;
    };
  }) {
    return this.database.client.$transaction(async (tx) => {
      const transfer = await tx.payoutProviderTransfer.findUniqueOrThrow({
        where: { id: input.transferId },
        include: { payout: true },
      });
      const nextState = this.toTransferState(input.state);
      assertProviderTransferTransition(transfer.state as ProviderTransferState, nextState);

      if (input.externalEvent) {
        const duplicate = await tx.payoutProviderEvent.findUnique({
          where: {
            provider_externalEventId: {
              provider: this.provider.kind,
              externalEventId: input.externalEvent.externalEventId,
            },
          },
        });
        if (duplicate) {
          return { ...this.safeResult(transfer.payout, transfer), duplicateEvent: true };
        }
        await tx.payoutProviderEvent.create({
          data: {
            transferId: transfer.id,
            provider: this.provider.kind,
            externalEventId: input.externalEvent.externalEventId,
            eventType: input.externalEvent.eventType,
            providerState: input.providerState.slice(0, 120),
            verified: true,
            payloadSha256: input.externalEvent.payloadSha256,
            processedAt: new Date(),
          },
        });
      }

      const now = new Date();
      const updatedTransfer = await tx.payoutProviderTransfer.update({
        where: { id: transfer.id },
        data: {
          state: nextState,
          providerResponseState: input.providerState.slice(0, 120),
          lastCheckedAt: now,
          ...(input.incrementStatusAttempts ? { statusAttempts: { increment: 1 } } : {}),
          ...(input.incrementCancelAttempts ? { cancelAttempts: { increment: 1 } } : {}),
          ...(nextState === "COMPLETED" ? { completedAt: now, nextRetryAt: null } : {}),
          ...(nextState === "CANCELLED" ? { cancelledAt: now, nextRetryAt: null } : {}),
        },
      });

      let payout = transfer.payout;
      if (nextState === "COMPLETED" && payout.status !== "PAID") {
        payout = await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: "PAID",
            paidAt: now,
            processedAt: payout.processedAt ?? now,
            externalReference: transfer.externalTransferId,
            failureReason: null,
          },
        });
      } else if (
        (nextState === "FAILED" || nextState === "CANCELLED") &&
        payout.status !== "PAID"
      ) {
        payout = await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: nextState === "FAILED" ? "FAILED" : "CANCELLED",
            processedAt: payout.processedAt ?? now,
            failureReason:
              nextState === "FAILED"
                ? `Provider reported failure: ${input.providerState}`
                : payout.failureReason,
          },
        });
        await tx.earningsLedgerEntry.updateMany({
          where: { payoutId: payout.id },
          data: { payoutId: null },
        });
      } else if (!isTerminalProviderTransferState(nextState) && payout.status === "PENDING") {
        payout = await tx.payout.update({
          where: { id: payout.id },
          data: { status: "PROCESSING", processedAt: now },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          actorAccountId: input.actorAccountId,
          action: "payout.provider_state_observed",
          entityType: "Payout",
          entityId: payout.id,
          reason: input.reason,
          metadata: {
            provider: this.provider.kind,
            transferId: transfer.id,
            externalTransferId: transfer.externalTransferId,
            from: transfer.state,
            to: nextState,
            providerState: input.providerState,
            source: input.source,
            payoutStatus: payout.status,
            paidConfirmed: nextState === "COMPLETED",
          },
        },
      });
      return this.safeResult(payout, updatedTransfer);
    });
  }

  private toTransferState(state: NormalizedProviderTransferState): ProviderTransferState {
    if (state === "PENDING") return "SUBMITTED";
    if (state === "PROCESSING") return "PROCESSING";
    if (state === "COMPLETED") return "COMPLETED";
    if (state === "FAILED") return "FAILED";
    if (state === "CANCELLED") return "CANCELLED";
    return "UNKNOWN";
  }

  private safeResult(
    payout: {
      id: string;
      status: string;
      amount: unknown;
      currency: string;
      externalReference: string | null;
    },
    transfer: {
      id: string;
      state: unknown;
      externalTransferId: string | null;
      providerResponseState: string | null;
      submitAttempts: number;
      statusAttempts: number;
      cancelAttempts: number;
      nextRetryAt: Date | null;
    },
  ) {
    return {
      payout: {
        id: payout.id,
        status: payout.status,
        amount: String(payout.amount),
        currency: payout.currency,
        externalReference: payout.externalReference,
      },
      transfer: {
        id: transfer.id,
        state: transfer.state,
        externalTransferId: transfer.externalTransferId,
        providerResponseState: transfer.providerResponseState,
        submitAttempts: transfer.submitAttempts,
        statusAttempts: transfer.statusAttempts,
        cancelAttempts: transfer.cancelAttempts,
        nextRetryAt: transfer.nextRetryAt,
      },
    };
  }

  private maskIdempotencyKey(value: string) {
    return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
  }
}
