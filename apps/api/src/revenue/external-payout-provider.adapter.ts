import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

export const EXTERNAL_PAYOUT_PROVIDER_ADAPTER = Symbol("EXTERNAL_PAYOUT_PROVIDER_ADAPTER");

export type NormalizedProviderTransferState =
  "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN";

export interface ExternalPayoutProviderCapabilities {
  provider: string;
  connected: boolean;
  productionEnabled: boolean;
  idempotentSubmission: boolean;
  supportsCancellation: boolean;
  supportsDestinationTokenization: boolean;
  webhookVerification: "CRYPTOGRAPHIC" | "UNSUPPORTED";
}

export interface SubmitTransferRequest {
  payoutId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
  destinationToken: string;
  legalName: string;
  countryCode: string | null;
}

export interface SubmitTransferResult {
  externalTransferId: string;
  providerState: string;
  state: "PENDING" | "PROCESSING";
}

export interface RetrieveTransferStatusResult {
  externalTransferId: string;
  providerState: string;
  state: NormalizedProviderTransferState;
}

export interface CancelTransferResult {
  externalTransferId: string;
  providerState: string;
  state: Exclude<NormalizedProviderTransferState, "COMPLETED">;
}

export interface DestinationVerificationRequest {
  destinationToken: string;
  currency: string;
  legalName: string;
  countryCode: string | null;
}

export interface DestinationVerificationResult {
  verified: boolean;
  providerState: string;
  destinationMask: string | null;
}

export interface VerifiedPayoutWebhookEvent {
  verified: true;
  externalEventId: string;
  externalTransferId: string;
  eventType: string;
  providerState: string;
  state: NormalizedProviderTransferState;
}

export interface ExternalPayoutProviderAdapter {
  readonly kind: string;
  capabilities(): ExternalPayoutProviderCapabilities;
  submitTransfer(request: SubmitTransferRequest): Promise<SubmitTransferResult>;
  retrieveTransferStatus(externalTransferId: string): Promise<RetrieveTransferStatusResult>;
  cancelTransfer(externalTransferId: string): Promise<CancelTransferResult>;
  verifyDestination(
    request: DestinationVerificationRequest,
  ): Promise<DestinationVerificationResult>;
  verifyWebhook(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    rawBody: Buffer,
  ): Promise<VerifiedPayoutWebhookEvent>;
}

export class ExternalPayoutProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly submissionMayHaveSucceeded: boolean,
    message = code,
  ) {
    super(message);
    this.name = "ExternalPayoutProviderError";
  }
}

export function verifyHmacSha256Signature(
  secret: string | Buffer,
  rawBody: Buffer,
  signature: string,
): boolean {
  const supplied = signature
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(supplied, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

@Injectable()
export class DisabledExternalPayoutProviderAdapter implements ExternalPayoutProviderAdapter {
  readonly kind = "UNCONFIGURED_EXTERNAL";

  capabilities(): ExternalPayoutProviderCapabilities {
    return {
      provider: this.kind,
      connected: false,
      productionEnabled: false,
      idempotentSubmission: false,
      supportsCancellation: false,
      supportsDestinationTokenization: false,
      webhookVerification: "UNSUPPORTED",
    };
  }

  private unavailable(): never {
    throw new ExternalPayoutProviderError(
      "PAYOUT_PROVIDER_NOT_CONFIGURED",
      false,
      false,
      "No approved external payout provider/account is configured.",
    );
  }

  async submitTransfer(): Promise<SubmitTransferResult> {
    return this.unavailable();
  }

  async retrieveTransferStatus(): Promise<RetrieveTransferStatusResult> {
    return this.unavailable();
  }

  async cancelTransfer(): Promise<CancelTransferResult> {
    return this.unavailable();
  }

  async verifyDestination(): Promise<DestinationVerificationResult> {
    return this.unavailable();
  }

  async verifyWebhook(): Promise<VerifiedPayoutWebhookEvent> {
    return this.unavailable();
  }
}
