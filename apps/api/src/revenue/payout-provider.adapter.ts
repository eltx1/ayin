import { Injectable } from "@nestjs/common";

export interface PayoutProviderRequest {
  payoutId: string;
  channelId: string;
  amount: string;
  currency: string;
  destinationMask: string;
}

export interface PayoutProviderHandoff {
  provider: string;
  mode: "MANUAL_REVIEW" | "EXTERNAL_PROVIDER";
  accepted: boolean;
  externalReference: string | null;
}

export interface PayoutProviderAdapter {
  readonly kind: string;
  readonly connected: boolean;
  createHandoff(request: PayoutProviderRequest): Promise<PayoutProviderHandoff>;
}

export const PAYOUT_PROVIDER_ADAPTER = Symbol("PAYOUT_PROVIDER_ADAPTER");

@Injectable()
export class ManualPayoutProviderAdapter implements PayoutProviderAdapter {
  readonly kind = "MANUAL";
  readonly connected = true;

  async createHandoff(_request: PayoutProviderRequest): Promise<PayoutProviderHandoff> {
    return {
      provider: this.kind,
      mode: "MANUAL_REVIEW",
      accepted: true,
      externalReference: null,
    };
  }
}
