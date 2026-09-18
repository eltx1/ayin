import { Injectable } from "@nestjs/common";

export const CREATOR_COMPLIANCE_ADAPTER = Symbol("CREATOR_COMPLIANCE_ADAPTER");

export type CreatorComplianceStatus =
  "NOT_STARTED" | "PENDING" | "VERIFIED" | "REQUIRES_ACTION" | "REJECTED";

export interface CreatorComplianceRequirements {
  identityRequired: boolean;
  taxRequired: boolean;
  payoutDestinationVerificationRequired: boolean;
  source: "NONE" | "PROVIDER" | "APPROVED_LEGAL_CONFIGURATION";
  version: string | null;
}

export interface CreatorComplianceCapabilities {
  provider: string;
  connected: boolean;
  productionEnabled: boolean;
  externalIdentityWorkflow: boolean;
  externalTaxWorkflow: boolean;
  tokenizedProviderReference: boolean;
}

export interface CreatorComplianceContext {
  channelId: string;
  countryCode: string | null;
  payoutProvider: string | null;
}

export interface CreatorComplianceWorkflowResult {
  status: CreatorComplianceStatus;
  externalProfileReference?: string | null;
  actionUrl?: string | null;
}

export interface CreatorComplianceProviderSnapshot {
  identityStatus: CreatorComplianceStatus;
  taxStatus: CreatorComplianceStatus;
}

export interface CreatorComplianceAdapter {
  readonly kind: string;
  capabilities(): CreatorComplianceCapabilities;
  requirements(context: CreatorComplianceContext): Promise<CreatorComplianceRequirements>;
  startIdentity(input: {
    context: CreatorComplianceContext;
    externalProfileReference: string | null;
  }): Promise<CreatorComplianceWorkflowResult>;
  startTax(input: {
    context: CreatorComplianceContext;
    externalProfileReference: string | null;
  }): Promise<CreatorComplianceWorkflowResult>;
  retrieveStatus(input: {
    context: CreatorComplianceContext;
    externalProfileReference: string;
  }): Promise<CreatorComplianceProviderSnapshot>;
}

export class CreatorComplianceProviderError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "CreatorComplianceProviderError";
  }
}

@Injectable()
export class DisabledCreatorComplianceAdapter implements CreatorComplianceAdapter {
  readonly kind = "UNCONFIGURED_COMPLIANCE";

  capabilities(): CreatorComplianceCapabilities {
    return {
      provider: this.kind,
      connected: false,
      productionEnabled: false,
      externalIdentityWorkflow: false,
      externalTaxWorkflow: false,
      tokenizedProviderReference: false,
    };
  }

  async requirements(): Promise<CreatorComplianceRequirements> {
    return {
      identityRequired: false,
      taxRequired: false,
      payoutDestinationVerificationRequired: false,
      source: "NONE",
      version: null,
    };
  }

  private unavailable(): never {
    throw new CreatorComplianceProviderError(
      "COMPLIANCE_PROVIDER_NOT_CONFIGURED",
      "No approved creator compliance provider/account is configured.",
    );
  }

  async startIdentity(): Promise<CreatorComplianceWorkflowResult> {
    return this.unavailable();
  }

  async startTax(): Promise<CreatorComplianceWorkflowResult> {
    return this.unavailable();
  }

  async retrieveStatus(): Promise<CreatorComplianceProviderSnapshot> {
    return this.unavailable();
  }
}
