import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { decryptPayoutDestination, encryptPayoutDestination } from "./creator-finance.crypto.js";
import {
  CREATOR_COMPLIANCE_ADAPTER,
  type CreatorComplianceAdapter,
  type CreatorComplianceStatus,
} from "./creator-compliance.adapter.js";
import {
  adminComplianceOverrideSchema,
  creatorComplianceStepSchema,
} from "./creator-compliance.schemas.js";

const STATUSES = new Set<CreatorComplianceStatus>([
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "REQUIRES_ACTION",
  "REJECTED",
]);

@Injectable()
export class CreatorComplianceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CREATOR_COMPLIANCE_ADAPTER)
    private readonly adapter: CreatorComplianceAdapter,
  ) {}

  capabilities() {
    return this.adapter.capabilities();
  }

  async creatorStatus(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    return this.statusForChannel(channel.id);
  }

  async statusForChannel(channelId: string) {
    const profile = await this.database.client.creatorPayoutProfile.findUnique({
      where: { channelId },
    });
    const context = {
      channelId,
      countryCode: profile?.countryCode ?? null,
      payoutProvider: profile?.provider ?? null,
    };
    const requirements = await this.adapter.requirements(context);
    const capabilities = this.adapter.capabilities();

    const identityStatus = this.normalizeStatus(profile?.identityStatus);
    const taxStatus = this.normalizeStatus(profile?.taxStatus);
    const payoutDestinationStatus = this.normalizeStatus(profile?.payoutDestinationStatus);

    const identityReady = !requirements.identityRequired || identityStatus === "VERIFIED";
    const taxReady = !requirements.taxRequired || taxStatus === "VERIFIED";
    const destinationReady =
      !requirements.payoutDestinationVerificationRequired || payoutDestinationStatus === "VERIFIED";

    const actionsRequired: string[] = [];
    if (!identityReady) actionsRequired.push(this.identityAction(identityStatus));
    if (!taxReady) actionsRequired.push(this.taxAction(taxStatus));
    if (!destinationReady) actionsRequired.push(this.destinationAction(payoutDestinationStatus));

    return {
      channelId,
      provider: {
        name: capabilities.provider,
        connected: capabilities.connected,
        productionEnabled: capabilities.productionEnabled,
        externalIdentityWorkflow: capabilities.externalIdentityWorkflow,
        externalTaxWorkflow: capabilities.externalTaxWorkflow,
      },
      requirements,
      identity: {
        status: identityStatus,
        required: requirements.identityRequired,
        actionAvailable:
          requirements.identityRequired &&
          capabilities.connected &&
          capabilities.productionEnabled &&
          capabilities.externalIdentityWorkflow &&
          identityStatus !== "VERIFIED",
      },
      tax: {
        status: taxStatus,
        required: requirements.taxRequired,
        actionAvailable:
          requirements.taxRequired &&
          capabilities.connected &&
          capabilities.productionEnabled &&
          capabilities.externalTaxWorkflow &&
          taxStatus !== "VERIFIED",
      },
      payoutDestination: {
        status: payoutDestinationStatus,
        required: requirements.payoutDestinationVerificationRequired,
        configured: Boolean(
          profile?.destinationEncrypted || profile?.providerDestinationTokenEncrypted,
        ),
        masked: profile?.destinationMask ?? null,
      },
      payoutComplianceEligible: identityReady && taxReady && destinationReady,
      actionsRequired,
      lastCheckedAt: profile?.complianceLastCheckedAt ?? null,
    };
  }

  async assertPayoutEligible(channelId: string) {
    const status = await this.statusForChannel(channelId);
    if (!status.payoutComplianceEligible) {
      throw new Error("PAYOUT_COMPLIANCE_NOT_ELIGIBLE");
    }
    return status;
  }

  async startCreatorStep(accountId: string, raw: unknown) {
    const input = creatorComplianceStepSchema.parse(raw);
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");
    const profile = await this.database.client.creatorPayoutProfile.findUniqueOrThrow({
      where: { channelId: channel.id },
    });
    const capabilities = this.adapter.capabilities();
    if (!capabilities.connected || !capabilities.productionEnabled) {
      throw new Error("COMPLIANCE_PROVIDER_NOT_CONFIGURED");
    }

    const context = {
      channelId: channel.id,
      countryCode: profile.countryCode,
      payoutProvider: profile.provider,
    };
    const requirements = await this.adapter.requirements(context);
    if (input.step === "IDENTITY" && !requirements.identityRequired) {
      throw new Error("IDENTITY_VERIFICATION_NOT_REQUIRED");
    }
    if (input.step === "TAX" && !requirements.taxRequired) {
      throw new Error("TAX_INFORMATION_NOT_REQUIRED");
    }

    const externalProfileReference = profile.complianceReferenceEncrypted
      ? decryptPayoutDestination(profile.complianceReferenceEncrypted)
      : null;
    const result =
      input.step === "IDENTITY"
        ? await this.adapter.startIdentity({ context, externalProfileReference })
        : await this.adapter.startTax({ context, externalProfileReference });

    const nextReference = result.externalProfileReference?.trim() || null;
    await this.database.client.$transaction(async (tx) => {
      await tx.creatorPayoutProfile.update({
        where: { id: profile.id },
        data: {
          ...(input.step === "IDENTITY" ? { identityStatus: result.status } : {}),
          ...(input.step === "TAX" ? { taxStatus: result.status } : {}),
          complianceProvider: this.adapter.kind,
          ...(nextReference
            ? { complianceReferenceEncrypted: encryptPayoutDestination(nextReference) }
            : {}),
          complianceLastCheckedAt: new Date(),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId: accountId,
          action: "creator.compliance_workflow_started",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          metadata: {
            channelId: channel.id,
            provider: this.adapter.kind,
            step: input.step,
            status: result.status,
            actionUrlReturned: Boolean(result.actionUrl),
            sensitiveReferenceLogged: false,
          },
        },
      });
    });

    return {
      step: input.step,
      status: result.status,
      actionUrl: result.actionUrl ?? null,
    };
  }

  async refreshCreator(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");
    const profile = await this.database.client.creatorPayoutProfile.findUniqueOrThrow({
      where: { channelId: channel.id },
    });
    const capabilities = this.adapter.capabilities();
    if (!capabilities.connected || !capabilities.productionEnabled) {
      throw new Error("COMPLIANCE_PROVIDER_NOT_CONFIGURED");
    }
    if (!profile.complianceReferenceEncrypted) {
      throw new Error("COMPLIANCE_PROVIDER_REFERENCE_MISSING");
    }

    const externalProfileReference = decryptPayoutDestination(profile.complianceReferenceEncrypted);
    const snapshot = await this.adapter.retrieveStatus({
      context: {
        channelId: channel.id,
        countryCode: profile.countryCode,
        payoutProvider: profile.provider,
      },
      externalProfileReference,
    });
    const now = new Date();
    await this.database.client.$transaction(async (tx) => {
      await tx.creatorPayoutProfile.update({
        where: { id: profile.id },
        data: {
          identityStatus: snapshot.identityStatus,
          taxStatus: snapshot.taxStatus,
          complianceProvider: this.adapter.kind,
          complianceLastCheckedAt: now,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId: accountId,
          action: "creator.compliance_status_refreshed",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          metadata: {
            channelId: channel.id,
            provider: this.adapter.kind,
            identityStatus: snapshot.identityStatus,
            taxStatus: snapshot.taxStatus,
            sensitiveReferenceLogged: false,
          },
        },
      });
    });
    return this.statusForChannel(channel.id);
  }

  async adminStatus(channelId: string) {
    await this.database.client.channel.findUniqueOrThrow({ where: { id: channelId } });
    return this.statusForChannel(channelId);
  }

  async adminOverride(actorAccountId: string, channelId: string, raw: unknown) {
    const input = adminComplianceOverrideSchema.parse(raw);
    const profile = await this.database.client.creatorPayoutProfile.findUniqueOrThrow({
      where: { channelId },
    });

    const field =
      input.field === "IDENTITY"
        ? "identityStatus"
        : input.field === "TAX"
          ? "taxStatus"
          : "payoutDestinationStatus";
    const previous = this.normalizeStatus(profile[field]);

    const updated = await this.database.client.$transaction(async (tx) => {
      const row = await tx.creatorPayoutProfile.update({
        where: { id: profile.id },
        data:
          input.field === "IDENTITY"
            ? { identityStatus: input.status }
            : input.field === "TAX"
              ? { taxStatus: input.status }
              : { payoutDestinationStatus: input.status },
      });
      await tx.adminAuditLog.create({
        data: {
          actorAccountId,
          action: "creator.compliance_status_overridden",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          reason: input.reason,
          metadata: {
            channelId,
            field: input.field,
            from: previous,
            to: input.status,
            rawIdentityDataAccessed: false,
            taxIdentifierAccessed: false,
            bankDataAccessed: false,
          },
        },
      });
      return row;
    });

    return {
      profileId: updated.id,
      field: input.field,
      status: input.status,
      compliance: await this.statusForChannel(channelId),
    };
  }

  private normalizeStatus(value: string | null | undefined): CreatorComplianceStatus {
    if (value === "NOT_PROVIDED") return "NOT_STARTED";
    if (value && STATUSES.has(value as CreatorComplianceStatus)) {
      return value as CreatorComplianceStatus;
    }
    return "NOT_STARTED";
  }

  private identityAction(status: CreatorComplianceStatus) {
    if (status === "REJECTED")
      return "Identity check could not be verified. Review the requested action.";
    if (status === "REQUIRES_ACTION") return "Complete the requested identity check action.";
    if (status === "PENDING") return "Identity check is still being reviewed.";
    return "Complete identity verification before payout.";
  }

  private taxAction(status: CreatorComplianceStatus) {
    if (status === "REJECTED")
      return "Tax information could not be accepted. Review the requested action.";
    if (status === "REQUIRES_ACTION") return "Complete the requested tax information action.";
    if (status === "PENDING") return "Tax information is still being reviewed.";
    return "Complete the required tax information before payout.";
  }

  private destinationAction(status: CreatorComplianceStatus) {
    if (status === "REJECTED") return "Payout destination could not be verified.";
    if (status === "REQUIRES_ACTION") return "Review your payout destination details.";
    if (status === "PENDING") return "Payout destination verification is still pending.";
    return "Set up and verify a payout destination.";
  }

  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }
}
