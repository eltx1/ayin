import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { normalizeTerritoryCode } from "./country-codes.js";

export interface VideoPolicyContext {
  countryCode?: string | undefined;
  isKidsProfile?: boolean | undefined;
  now?: Date | undefined;
}

export type VideoPolicyDecisionReason =
  | "AVAILABLE"
  | "ADMIN_FORCE_ALLOW"
  | "ADMIN_FORCE_BLOCK"
  | "RIGHTS_EXPIRED"
  | "REGION_UNKNOWN"
  | "REGION_NOT_ALLOWED"
  | "REGION_BLOCKED"
  | "KIDS_PROFILE_RESTRICTED";

export interface VideoPolicyDecision {
  allowed: boolean;
  reason: VideoPolicyDecisionReason;
  maturityLevel: "GENERAL" | "TEEN" | "MATURE" | null;
  ageRestriction: "NONE" | "AGE_13_PLUS" | "AGE_18_PLUS";
  rightsExpiresAt: Date | null;
  countryCode: string | null;
  overrideDisposition: "FORCE_ALLOW" | "FORCE_BLOCK" | null;
}

type PolicyRecord = {
  videoId: string;
  maturityLevel: "GENERAL" | "TEEN" | "MATURE" | null;
  allowedTerritories: string[];
  blockedTerritories: string[];
  rightsExpiresAt: Date | null;
  ageRestriction: "NONE" | "AGE_13_PLUS" | "AGE_18_PLUS";
};

type OverrideRecord = {
  videoId: string;
  disposition: "FORCE_ALLOW" | "FORCE_BLOCK";
  expiresAt: Date | null;
};

@Injectable()
export class VideoPolicyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async decide(videoId: string, context: VideoPolicyContext = {}): Promise<VideoPolicyDecision> {
    const [policy, override] = await Promise.all([
      this.database.client.videoPolicy.findUnique({ where: { videoId } }),
      this.database.client.videoPolicyOverride.findUnique({ where: { videoId } }),
    ]);
    return evaluatePolicy(policy, override, context);
  }

  async decideMany(videoIds: string[], context: VideoPolicyContext = {}) {
    const ids = [...new Set(videoIds)];
    if (!ids.length) return new Map<string, VideoPolicyDecision>();
    const [policies, overrides] = await Promise.all([
      this.database.client.videoPolicy.findMany({ where: { videoId: { in: ids } } }),
      this.database.client.videoPolicyOverride.findMany({ where: { videoId: { in: ids } } }),
    ]);
    const policyByVideo = new Map(policies.map((item) => [item.videoId, item]));
    const overrideByVideo = new Map(overrides.map((item) => [item.videoId, item]));
    return new Map(
      ids.map((videoId) => [
        videoId,
        evaluatePolicy(
          policyByVideo.get(videoId) ?? null,
          overrideByVideo.get(videoId) ?? null,
          context,
        ),
      ]),
    );
  }

  async filterAvailableVideoIds(videoIds: string[], context: VideoPolicyContext = {}) {
    const decisions = await this.decideMany(videoIds, context);
    return new Set(
      [...decisions].filter(([, decision]) => decision.allowed).map(([videoId]) => videoId),
    );
  }

  async readPolicy(videoId: string) {
    const [policy, override] = await Promise.all([
      this.database.client.videoPolicy.findUnique({ where: { videoId } }),
      this.database.client.videoPolicyOverride.findUnique({ where: { videoId } }),
    ]);
    return {
      policy: policy
        ? {
            maturityLevel: policy.maturityLevel,
            allowedTerritories: policy.allowedTerritories,
            blockedTerritories: policy.blockedTerritories,
            rightsExpiresAt: policy.rightsExpiresAt,
            ageRestriction: policy.ageRestriction,
          }
        : {
            maturityLevel: null,
            allowedTerritories: [],
            blockedTerritories: [],
            rightsExpiresAt: null,
            ageRestriction: "NONE" as const,
          },
      override,
    };
  }
}

export function evaluatePolicy(
  policy: PolicyRecord | null | undefined,
  override: OverrideRecord | null | undefined,
  context: VideoPolicyContext = {},
): VideoPolicyDecision {
  const now = context.now ?? new Date();
  const countryCode = normalizeTerritoryCode(context.countryCode) ?? null;
  const activeOverride =
    override && (!override.expiresAt || override.expiresAt > now) ? override : null;
  const snapshot = {
    maturityLevel: policy?.maturityLevel ?? null,
    ageRestriction: policy?.ageRestriction ?? ("NONE" as const),
    rightsExpiresAt: policy?.rightsExpiresAt ?? null,
    countryCode,
    overrideDisposition: activeOverride?.disposition ?? null,
  };

  if (activeOverride?.disposition === "FORCE_BLOCK") {
    return { allowed: false, reason: "ADMIN_FORCE_BLOCK", ...snapshot };
  }
  if (activeOverride?.disposition === "FORCE_ALLOW") {
    return { allowed: true, reason: "ADMIN_FORCE_ALLOW", ...snapshot };
  }
  if (policy?.rightsExpiresAt && policy.rightsExpiresAt <= now) {
    return { allowed: false, reason: "RIGHTS_EXPIRED", ...snapshot };
  }

  const hasGeoRule = Boolean(
    policy?.allowedTerritories.length || policy?.blockedTerritories.length,
  );
  if (hasGeoRule && !countryCode) {
    return { allowed: false, reason: "REGION_UNKNOWN", ...snapshot };
  }
  if (
    countryCode &&
    policy?.allowedTerritories.length &&
    !policy.allowedTerritories.includes(countryCode)
  ) {
    return { allowed: false, reason: "REGION_NOT_ALLOWED", ...snapshot };
  }
  if (countryCode && policy?.blockedTerritories.includes(countryCode)) {
    return { allowed: false, reason: "REGION_BLOCKED", ...snapshot };
  }
  if (
    context.isKidsProfile === true &&
    ((policy?.maturityLevel !== null &&
      policy?.maturityLevel !== undefined &&
      policy.maturityLevel !== "GENERAL") ||
      (policy?.ageRestriction ?? "NONE") !== "NONE")
  ) {
    return { allowed: false, reason: "KIDS_PROFILE_RESTRICTED", ...snapshot };
  }
  return { allowed: true, reason: "AVAILABLE", ...snapshot };
}
