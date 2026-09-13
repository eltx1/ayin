from pathlib import Path


def write(path: str, content: str) -> None:
    file = Path(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:180]!r}")
    file.write_text(text.replace(old, new, count))


write("packages/db/prisma/video-policy.prisma", r'''enum VideoAgeRestriction {
  NONE
  AGE_13_PLUS
  AGE_18_PLUS
}

enum VideoPolicyOverrideDisposition {
  FORCE_ALLOW
  FORCE_BLOCK
}

// Authoritative distribution policy. Absence of a row means the simple AYIN
// default: worldwide availability, no expiry and no age gate.
model VideoPolicy {
  videoId            String              @id @db.Uuid
  maturityLevel      VideoMaturityLevel?
  allowedTerritories String[]            @default([])
  blockedTerritories String[]            @default([])
  rightsExpiresAt    DateTime?
  ageRestriction     VideoAgeRestriction @default(NONE)
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  @@index([maturityLevel])
  @@index([rightsExpiresAt])
}

// Administrative policy override only. It never overrides Video publication,
// visibility, channel state or removal state; those remain hard boundaries.
model VideoPolicyOverride {
  videoId        String                         @id @db.Uuid
  disposition    VideoPolicyOverrideDisposition
  reason         String                         @db.Text
  actorAccountId String                         @db.Uuid
  expiresAt      DateTime?
  createdAt      DateTime                       @default(now())
  updatedAt      DateTime                       @updatedAt

  @@index([disposition, expiresAt])
  @@index([actorAccountId, updatedAt])
}
''')

write("packages/db/prisma/migrations/20260913010000_video_policy_controls/migration.sql", r'''CREATE TYPE "VideoAgeRestriction" AS ENUM ('NONE', 'AGE_13_PLUS', 'AGE_18_PLUS');
CREATE TYPE "VideoPolicyOverrideDisposition" AS ENUM ('FORCE_ALLOW', 'FORCE_BLOCK');

CREATE TABLE "VideoPolicy" (
  "videoId" UUID NOT NULL,
  "maturityLevel" "VideoMaturityLevel",
  "allowedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rightsExpiresAt" TIMESTAMP(3),
  "ageRestriction" "VideoAgeRestriction" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoPolicy_pkey" PRIMARY KEY ("videoId")
);

CREATE TABLE "VideoPolicyOverride" (
  "videoId" UUID NOT NULL,
  "disposition" "VideoPolicyOverrideDisposition" NOT NULL,
  "reason" TEXT NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoPolicyOverride_pkey" PRIMARY KEY ("videoId")
);

CREATE INDEX "VideoPolicy_maturityLevel_idx" ON "VideoPolicy"("maturityLevel");
CREATE INDEX "VideoPolicy_rightsExpiresAt_idx" ON "VideoPolicy"("rightsExpiresAt");
CREATE INDEX "VideoPolicy_allowedTerritories_gin_idx" ON "VideoPolicy" USING GIN ("allowedTerritories");
CREATE INDEX "VideoPolicy_blockedTerritories_gin_idx" ON "VideoPolicy" USING GIN ("blockedTerritories");
CREATE INDEX "VideoPolicyOverride_disposition_expiresAt_idx" ON "VideoPolicyOverride"("disposition", "expiresAt");
CREATE INDEX "VideoPolicyOverride_actorAccountId_updatedAt_idx" ON "VideoPolicyOverride"("actorAccountId", "updatedAt");

ALTER TABLE "VideoPolicy"
  ADD CONSTRAINT "VideoPolicy_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoPolicyOverride"
  ADD CONSTRAINT "VideoPolicyOverride_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoPolicyOverride"
  ADD CONSTRAINT "VideoPolicyOverride_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Task 51 stored maturity/geography as non-enforcing metadata hooks. Preserve
-- those creator choices while promoting them into the authoritative policy
-- domain. Videos that never used advanced policy metadata keep no policy row.
INSERT INTO "VideoPolicy" (
  "videoId",
  "maturityLevel",
  "allowedTerritories",
  "blockedTerritories",
  "createdAt",
  "updatedAt"
)
SELECT
  "videoId",
  "maturityLevel",
  CASE
    WHEN "geoAvailabilityMode"::text = 'INCLUDE_ONLY' THEN "geoCountries"
    ELSE ARRAY[]::TEXT[]
  END,
  CASE
    WHEN "geoAvailabilityMode"::text = 'EXCLUDE' THEN "geoCountries"
    ELSE ARRAY[]::TEXT[]
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "VideoCreatorMetadata"
WHERE "maturityLevel" IS NOT NULL
   OR "geoAvailabilityMode" IS NOT NULL
   OR cardinality("geoCountries") > 0
ON CONFLICT ("videoId") DO NOTHING;
''')

write("apps/api/src/video-policy/country-codes.ts", r'''const CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`;

export const ISO_3166_ALPHA2 = new Set(CODES.split(" "));

export function normalizeTerritoryCode(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  return ISO_3166_ALPHA2.has(normalized) ? normalized : undefined;
}

export function normalizeTerritoryCodes(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeTerritoryCode(value)).filter((value): value is string => Boolean(value)))];
}
''')

write("apps/api/src/video-policy/trusted-region.service.ts", r'''import { timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { normalizeTerritoryCode } from "./country-codes.js";

export type HeaderBag = Record<string, string | string[] | undefined>;

@Injectable()
export class TrustedRegionService {
  countryFromHeaders(headers: HeaderBag): string | undefined {
    if (process.env.AYIN_TRUST_CLOUDFLARE_REGION === "true") {
      const cloudflare = normalizeTerritoryCode(firstHeader(headers["cf-ipcountry"]));
      if (cloudflare) return cloudflare;
    }

    const expectedToken = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
    const suppliedToken = firstHeader(headers["x-ayin-edge-token"]);
    if (!expectedToken || !suppliedToken || !safeTokenEqual(expectedToken, suppliedToken)) {
      return undefined;
    }
    return normalizeTerritoryCode(firstHeader(headers["x-ayin-edge-country"]));
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeTokenEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
''')

write("apps/api/src/video-policy/video-policy.service.ts", r'''import { Inject, Injectable } from "@nestjs/common";

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
        evaluatePolicy(policyByVideo.get(videoId) ?? null, overrideByVideo.get(videoId) ?? null, context),
      ]),
    );
  }

  async filterAvailableVideoIds(videoIds: string[], context: VideoPolicyContext = {}) {
    const decisions = await this.decideMany(videoIds, context);
    return new Set([...decisions].filter(([, decision]) => decision.allowed).map(([videoId]) => videoId));
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
  const activeOverride = override && (!override.expiresAt || override.expiresAt > now) ? override : null;
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

  const hasGeoRule = Boolean(policy?.allowedTerritories.length || policy?.blockedTerritories.length);
  if (hasGeoRule && !countryCode) {
    return { allowed: false, reason: "REGION_UNKNOWN", ...snapshot };
  }
  if (countryCode && policy?.allowedTerritories.length && !policy.allowedTerritories.includes(countryCode)) {
    return { allowed: false, reason: "REGION_NOT_ALLOWED", ...snapshot };
  }
  if (countryCode && policy?.blockedTerritories.includes(countryCode)) {
    return { allowed: false, reason: "REGION_BLOCKED", ...snapshot };
  }
  if (
    context.isKidsProfile === true &&
    ((policy?.maturityLevel !== null && policy?.maturityLevel !== undefined && policy.maturityLevel !== "GENERAL") ||
      (policy?.ageRestriction ?? "NONE") !== "NONE")
  ) {
    return { allowed: false, reason: "KIDS_PROFILE_RESTRICTED", ...snapshot };
  }
  return { allowed: true, reason: "AVAILABLE", ...snapshot };
}
''')

write("apps/api/src/video-policy/video-policy.module.ts", r'''import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TrustedRegionService } from "./trusted-region.service.js";
import { VideoPolicyService } from "./video-policy.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [VideoPolicyService, TrustedRegionService],
  exports: [VideoPolicyService, TrustedRegionService],
})
export class VideoPolicyModule {}
''')

write("apps/api/src/video-policy/video-policy.service.test.ts", r'''import { describe, expect, it, vi } from "vitest";

import { VideoPolicyService, evaluatePolicy } from "./video-policy.service.js";

const basePolicy = {
  videoId: "11111111-1111-4111-8111-111111111111",
  maturityLevel: "GENERAL" as const,
  allowedTerritories: ["US", "EG"],
  blockedTerritories: ["GB"],
  rightsExpiresAt: null,
  ageRestriction: "NONE" as const,
};

describe("VideoPolicyService decisions", () => {
  it("allows an explicitly allowed standard territory", () => {
    expect(evaluatePolicy(basePolicy, null, { countryCode: "us" })).toMatchObject({
      allowed: true,
      reason: "AVAILABLE",
      countryCode: "US",
    });
  });

  it("blocks a blocked territory", () => {
    expect(
      evaluatePolicy({ ...basePolicy, allowedTerritories: [] }, null, { countryCode: "GB" }),
    ).toMatchObject({ allowed: false, reason: "REGION_BLOCKED" });
  });

  it("treats an unknown region conservatively when any geographic rule exists", () => {
    expect(evaluatePolicy(basePolicy, null, {})).toMatchObject({
      allowed: false,
      reason: "REGION_UNKNOWN",
    });
  });

  it("allows an active audited admin FORCE_ALLOW to override geo and expiry policy", () => {
    const expired = { ...basePolicy, rightsExpiresAt: new Date("2026-01-01T00:00:00.000Z") };
    expect(
      evaluatePolicy(
        expired,
        { videoId: basePolicy.videoId, disposition: "FORCE_ALLOW", expiresAt: null },
        { countryCode: "DE", now: new Date("2026-09-13T00:00:00.000Z") },
      ),
    ).toMatchObject({ allowed: true, reason: "ADMIN_FORCE_ALLOW" });
  });

  it("blocks an active admin FORCE_BLOCK", () => {
    expect(
      evaluatePolicy(
        null,
        { videoId: basePolicy.videoId, disposition: "FORCE_BLOCK", expiresAt: null },
        { countryCode: "US" },
      ),
    ).toMatchObject({ allowed: false, reason: "ADMIN_FORCE_BLOCK" });
  });

  it("uses maturity and age restriction as a kids-profile eligibility hook without claiming compliance", () => {
    expect(
      evaluatePolicy(
        { ...basePolicy, allowedTerritories: [], blockedTerritories: [], maturityLevel: "TEEN" },
        null,
        { isKidsProfile: true },
      ),
    ).toMatchObject({ allowed: false, reason: "KIDS_PROFILE_RESTRICTED" });
  });

  it("filters a batch consistently", async () => {
    const database = {
      client: {
        videoPolicy: { findMany: vi.fn().mockResolvedValue([basePolicy]) },
        videoPolicyOverride: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };
    const service = new VideoPolicyService(database as never);
    const allowed = await service.filterAvailableVideoIds([basePolicy.videoId], { countryCode: "EG" });
    expect(allowed.has(basePolicy.videoId)).toBe(true);
  });
});
''')

write("apps/api/src/admin/admin-video-policy.service.ts", r'''import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";

export interface AdminPolicyOverrideInput {
  disposition: "FORCE_ALLOW" | "FORCE_BLOCK";
  reason: string;
  expiresAt: Date | null;
}

@Injectable()
export class AdminVideoPolicyService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly policy: VideoPolicyService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async get(videoId: string) {
    await this.assertVideo(videoId);
    return { videoId, ...(await this.policy.readPolicy(videoId)) };
  }

  async setOverride(actorAccountId: string, videoId: string, input: AdminPolicyOverrideInput) {
    await this.assertVideo(videoId);
    const previous = await this.database.client.videoPolicyOverride.findUnique({ where: { videoId } });
    const override = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.videoPolicyOverride.upsert({
        where: { videoId },
        create: { videoId, actorAccountId, ...input },
        update: { actorAccountId, ...input },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video_policy.override_set",
        entityType: "Video",
        entityId: videoId,
        reason: input.reason,
        metadata: {
          disposition: input.disposition,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          previousDisposition: previous?.disposition ?? null,
          previousExpiresAt: previous?.expiresAt?.toISOString() ?? null,
        },
      });
      return saved;
    });
    return { videoId, override };
  }

  async clearOverride(actorAccountId: string, videoId: string, reason: string) {
    await this.assertVideo(videoId);
    const previous = await this.database.client.videoPolicyOverride.findUnique({ where: { videoId } });
    await this.database.client.$transaction(async (tx) => {
      await tx.videoPolicyOverride.deleteMany({ where: { videoId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video_policy.override_clear",
        entityType: "Video",
        entityId: videoId,
        reason,
        metadata: {
          previousDisposition: previous?.disposition ?? null,
          previousExpiresAt: previous?.expiresAt?.toISOString() ?? null,
        },
      });
    });
    return { videoId, override: null };
  }

  private async assertVideo(videoId: string) {
    const video = await this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true } });
    if (!video) throw new NotFoundException("This video could not be found.");
  }
}
''')

write("apps/api/src/admin/admin-video-policy.controller.ts", r'''import { Body, Controller, Delete, Get, Inject, Param, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";
import { AdminVideoPolicyService } from "./admin-video-policy.service.js";

const videoIdSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(1000);
const overrideSchema = z
  .object({
    disposition: z.enum(["FORCE_ALLOW", "FORCE_BLOCK"]),
    reason: reasonSchema,
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const clearSchema = z.object({ reason: reasonSchema }).strict();

@Controller("admin/video-policies")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS", "CONTENT_MODERATOR")
export class AdminVideoPolicyController {
  constructor(@Inject(AdminVideoPolicyService) private readonly policies: AdminVideoPolicyService) {}

  @Get(":videoId")
  async get(@Param("videoId") videoIdRaw: string) {
    return this.policies.get(parseVideoId(videoIdRaw));
  }

  @Put(":videoId/override")
  @RequireAdminStepUp()
  async setOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = overrideSchema.safeParse(body);
    if (!parsed.success) throw adminBadRequest("INVALID_VIDEO_POLICY_OVERRIDE", "Check the override disposition, reason and expiry.");
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw adminBadRequest("INVALID_VIDEO_POLICY_OVERRIDE", "Override expiry must be in the future.");
    }
    return this.policies.setOverride(request.ayinAuth.accountId, parseVideoId(videoIdRaw), {
      disposition: parsed.data.disposition,
      reason: parsed.data.reason,
      expiresAt,
    });
  }

  @Delete(":videoId/override")
  @RequireAdminStepUp()
  async clearOverride(
    @Req() request: AdminAuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = clearSchema.safeParse(body);
    if (!parsed.success) throw adminBadRequest("INVALID_VIDEO_POLICY_OVERRIDE", "An audit reason is required to clear an override.");
    return this.policies.clearOverride(request.ayinAuth.accountId, parseVideoId(videoIdRaw), parsed.data.reason);
  }
}

function parseVideoId(raw: string) {
  const parsed = videoIdSchema.safeParse(raw);
  if (!parsed.success) throw adminBadRequest("INVALID_VIDEO_ID", "This video id is invalid.");
  return parsed.data;
}
''')

write("apps/api/src/admin/admin-video-policy.service.test.ts", r'''import { describe, expect, it, vi } from "vitest";

import { AdminVideoPolicyService } from "./admin-video-policy.service.js";

describe("AdminVideoPolicyService", () => {
  it("writes an override and an audit record in the same transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({ videoId: "video", disposition: "FORCE_ALLOW" });
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const tx = { videoPolicyOverride: { upsert } };
    const database = {
      client: {
        video: { findUnique: vi.fn().mockResolvedValue({ id: "video" }) },
        videoPolicyOverride: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const policy = { readPolicy: vi.fn() };
    const service = new AdminVideoPolicyService(database as never, policy as never, audit as never);
    await service.setOverride("admin", "video", {
      disposition: "FORCE_ALLOW",
      reason: "Rights team approved a temporary exception.",
      expiresAt: null,
    });
    expect(upsert).toHaveBeenCalled();
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "video_policy.override_set", entityId: "video" }),
    );
  });
});
''')

write("apps/web/src/lib/trusted-region.ts", r'''import { headers } from "next/headers";

export async function trustedApiRegionHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const country = incoming.get("cf-ipcountry")?.trim().toUpperCase();
  const token = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
  if (!country || !/^[A-Z]{2}$/.test(country) || !token) return {};
  return {
    "x-ayin-edge-country": country,
    "x-ayin-edge-token": token,
  };
}
''')

write("docs/TASK53_VIDEO_POLICY.md", r'''# TASK 53 — Rights, geography and maturity policy

AYIN now has one authoritative video-availability policy used by playback, catalog surfaces, search, SEO and Creator TV. Ordinary creators still get the simple default: if no policy row exists, the video is worldwide with no rights expiry or age gate.

## Ownership

- `ContentRightsDeclaration` remains the legal rights declaration. Creator rights notes continue to append to the declaration without replacing its attestation.
- `VideoPolicy` owns enforceable maturity, territory, distribution-expiry and age-gate hooks.
- Task 51 maturity/geography columns are legacy metadata only. The migration backfills their values into `VideoPolicy`; new writes target the policy domain.
- `VideoPolicyOverride` is administrative policy state. It cannot bypass publication, PRIVATE visibility, removal or channel-state boundaries.

## Territory enforcement

Territories use ISO 3166-1 alpha-2 identifiers. Free-form country text is rejected. An empty allow list plus empty block list means worldwide availability. If any geographic restriction exists and AYIN has no trusted country signal, availability is denied conservatively.

`x-ayin-region` remains personalization-only and has no rights authority. Enforcement accepts either Cloudflare `CF-IPCountry` when `AYIN_TRUST_CLOUDFLARE_REGION=true`, or an internal `x-ayin-edge-country` header authenticated with `AYIN_INTERNAL_EDGE_TOKEN`. Production origins must remain protected from direct untrusted header injection.

## Maturity and age hook

Maturity and age-restriction fields are product-policy signals. They are used to keep non-general/restricted videos out of kids profiles and to expose an age-gate hook to playback clients. They do **not** by themselves establish legal or regulatory compliance, perform age verification, or replace jurisdiction-specific review.

## Admin overrides

OPERATIONS and CONTENT_MODERATOR staff can set or clear FORCE_ALLOW/FORCE_BLOCK overrides only through step-up protected admin endpoints. Every mutation requires a reason and is written with an `AdminAuditLog` in the same transaction. Expiring overrides automatically stop affecting decisions after their expiry time.

## SEO

Geo-restricted or rights-expired videos are not returned as available SEO video metadata when the request is unavailable in its trusted region. Sitemaps use conservative unknown-region evaluation, so only content safe for global indexing is emitted. PRIVATE content remains unavailable and UNLISTED content remains non-indexable.
''')

# API environment trust configuration.
replace(
    "apps/api/.env.example",
    "AUTH_PASSWORD_RESET_TTL_SECONDS=1800\n",
    "AUTH_PASSWORD_RESET_TTL_SECONDS=1800\n\n# Trusted region enforcement. Enable Cloudflare country headers only when the API origin is protected behind Cloudflare.\nAYIN_TRUST_CLOUDFLARE_REGION=false\nAYIN_INTERNAL_EDGE_TOKEN=\n",
)
replace(
    "apps/web/.env.example",
    "NEXT_PUBLIC_MEDIA_BASE_URL=https://media.ayin.stream\n",
    "NEXT_PUBLIC_MEDIA_BASE_URL=https://media.ayin.stream\n# Same private value as the API; server-only and never NEXT_PUBLIC.\nAYIN_INTERNAL_EDGE_TOKEN=\n",
)

# Register the policy module globally where availability decisions are made.
replace(
    "apps/api/src/app.module.ts",
    'import { WatchModule } from "./watch/watch.module.js";\n',
    'import { VideoPolicyModule } from "./video-policy/video-policy.module.js";\nimport { WatchModule } from "./watch/watch.module.js";\n',
)
replace(
    "apps/api/src/app.module.ts",
    "    TrustModule,\n  ],",
    "    TrustModule,\n    VideoPolicyModule,\n  ],",
)

replace(
    "apps/api/src/watch/watch.module.ts",
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\n',
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/watch/watch.module.ts",
    "  imports: [AuthModule, DatabaseModule, PlatformConfigModule],",
    "  imports: [AuthModule, DatabaseModule, PlatformConfigModule, VideoPolicyModule],",
)
replace(
    "apps/api/src/discovery/discovery.module.ts",
    'import { DatabaseModule } from "../database/database.module.js";\n',
    'import { DatabaseModule } from "../database/database.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/discovery/discovery.module.ts",
    "  imports: [AuthModule, DatabaseModule],",
    "  imports: [AuthModule, DatabaseModule, VideoPolicyModule],",
)
replace(
    "apps/api/src/search/search.module.ts",
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\n',
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/search/search.module.ts",
    "  imports: [DatabaseModule, PlatformConfigModule],",
    "  imports: [DatabaseModule, PlatformConfigModule, VideoPolicyModule],",
)
replace(
    "apps/api/src/seo/seo.module.ts",
    'import { Module } from "@nestjs/common";\n\n',
    'import { Module } from "@nestjs/common";\n\nimport { DatabaseModule } from "../database/database.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/seo/seo.module.ts",
    "@Module({\n  controllers:",
    "@Module({\n  imports: [DatabaseModule, VideoPolicyModule],\n  controllers:",
)
replace(
    "apps/api/src/creator/creator.module.ts",
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\n',
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/creator/creator.module.ts",
    "  imports: [AuthModule, DatabaseModule, MediaModule, PlatformConfigModule],",
    "  imports: [AuthModule, DatabaseModule, MediaModule, PlatformConfigModule, VideoPolicyModule],",
)

# Admin policy endpoints + services.
replace(
    "apps/api/src/admin/admin.module.ts",
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\n',
    'import { PlatformConfigModule } from "../platform-config/platform-config.module.js";\nimport { VideoPolicyModule } from "../video-policy/video-policy.module.js";\n',
)
replace(
    "apps/api/src/admin/admin.module.ts",
    'import { AdminVideoMetadataController } from "./admin-video-metadata.controller.js";\n',
    'import { AdminVideoMetadataController } from "./admin-video-metadata.controller.js";\nimport { AdminVideoPolicyController } from "./admin-video-policy.controller.js";\nimport { AdminVideoPolicyService } from "./admin-video-policy.service.js";\n',
)
replace(
    "apps/api/src/admin/admin.module.ts",
    "  imports: [AuthModule, CreatorModule, MediaModule, PlatformConfigModule],",
    "  imports: [AuthModule, CreatorModule, MediaModule, PlatformConfigModule, VideoPolicyModule],",
)
replace(
    "apps/api/src/admin/admin.module.ts",
    "    AdminVideoMetadataController,\n",
    "    AdminVideoMetadataController,\n    AdminVideoPolicyController,\n",
)
replace(
    "apps/api/src/admin/admin.module.ts",
    "    AdminSettingsService,\n",
    "    AdminSettingsService,\n    AdminVideoPolicyService,\n",
)

# Replace validation with authoritative policy-aware input validation.
write("apps/api/src/creator/video-metadata.validation.ts", r'''import { z } from "zod";

import { ISO_3166_ALPHA2 } from "../video-policy/country-codes.js";

export const VIDEO_DESCRIPTION_MAX_LENGTH = 20_000;
export const VIDEO_TAG_MAX_COUNT = 20;
export const VIDEO_TAG_MAX_LENGTH = 40;
export const VIDEO_CHAPTER_MAX_COUNT = 100;
export const VIDEO_CHAPTER_TITLE_MAX_LENGTH = 100;
export const VIDEO_AD_BREAK_MAX_COUNT = 20;
export const VIDEO_TERRITORY_MAX_COUNT = 100;

export const VIDEO_CATEGORIES = ["ENTERTAINMENT", "EDUCATION", "GAMING", "MUSIC", "NEWS", "SPORTS", "TECHNOLOGY", "LIFESTYLE", "FILM_ANIMATION", "OTHER"] as const;
export const VIDEO_CONTENT_TYPES = ["CREATOR_VIDEO", "MOVIE", "DOCUMENTARY"] as const;
export const RIGHTS_BASES = ["OWNED", "LICENSED", "AUTHORIZED", "PUBLIC_DOMAIN", "OTHER"] as const;

const languageSchema = z.string().trim().min(2).max(35).refine((value) => {
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
}, "Use a valid BCP 47 language code, such as en or ar-EG.").transform((value) => Intl.getCanonicalLocales(value)[0]!);
const tagSchema = z.string().trim().min(1).max(VIDEO_TAG_MAX_LENGTH);
const territorySchema = z.string().trim().transform((value) => value.toUpperCase()).refine(
  (value) => ISO_3166_ALPHA2.has(value),
  "Use an ISO 3166-1 alpha-2 country code such as EG, US or GB.",
);
const territoryListSchema = z.array(territorySchema).max(VIDEO_TERRITORY_MAX_COUNT).transform((values) => [...new Set(values)]);
const chapterSchema = z.object({ title: z.string().trim().min(1).max(VIDEO_CHAPTER_TITLE_MAX_LENGTH), startSeconds: z.number().finite().int().min(0) });

export const videoMetadataSchema = z.object({
  tags: z.array(tagSchema).max(VIDEO_TAG_MAX_COUNT).transform((tags) => [...new Set(tags.map((tag) => tag.toLocaleLowerCase()))]).optional(),
  category: z.enum(VIDEO_CATEGORIES).nullable().optional(),
  primaryLanguage: languageSchema.nullable().optional(),
  recordingDate: z.string().date().nullable().optional(),
  contentType: z.enum(VIDEO_CONTENT_TYPES).optional(),
  rightsBasis: z.enum(RIGHTS_BASES).optional(),
  rightsNote: z.string().trim().max(1_000).nullable().optional(),
  rightsExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  seriesTitle: z.string().trim().min(1).max(120).nullable().optional(),
  seasonNumber: z.number().int().min(1).max(10_000).nullable().optional(),
  episodeNumber: z.number().int().min(1).max(100_000).nullable().optional(),
  maturityLevel: z.enum(["GENERAL", "TEEN", "MATURE"]).nullable().optional(),
  ageRestriction: z.enum(["NONE", "AGE_13_PLUS", "AGE_18_PLUS"]).nullable().optional(),
  allowedTerritories: territoryListSchema.optional(),
  blockedTerritories: territoryListSchema.optional(),
  // Legacy Task 51 compatibility. New clients use allow/block lists directly.
  geoAvailabilityMode: z.enum(["WORLDWIDE", "INCLUDE_ONLY", "EXCLUDE"]).nullable().optional(),
  geoCountries: territoryListSchema.optional(),
  chapters: z.array(chapterSchema).max(VIDEO_CHAPTER_MAX_COUNT).nullable().optional(),
  adBreakPreference: z.enum(["AUTOMATIC", "DISABLED", "CUSTOM"]).nullable().optional(),
  adBreakOffsetsSeconds: z.array(z.number().finite().int().min(1)).max(VIDEO_AD_BREAK_MAX_COUNT).transform((offsets) => [...new Set(offsets)].sort((a, b) => a - b)).optional(),
}).superRefine((value, context) => {
  if (value.recordingDate && new Date(`${value.recordingDate}T00:00:00.000Z`).getTime() > Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recordingDate"], message: "Recording date cannot be in the future." });
  }
  if ((value.allowedTerritories !== undefined || value.blockedTerritories !== undefined) && (value.geoAvailabilityMode !== undefined || value.geoCountries !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedTerritories"], message: "Use either allow/block territory lists or the legacy geographic mode, not both." });
  }
  const blocked = new Set(value.blockedTerritories ?? []);
  const overlap = (value.allowedTerritories ?? []).find((country) => blocked.has(country));
  if (overlap) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockedTerritories"], message: `${overlap} cannot be both allowed and blocked.` });
  }
  if (value.geoAvailabilityMode === "WORLDWIDE" && (value.geoCountries?.length ?? 0) > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["geoCountries"], message: "Worldwide availability cannot include a country list." });
  }
  if ((value.geoAvailabilityMode === "INCLUDE_ONLY" || value.geoAvailabilityMode === "EXCLUDE") && (value.geoCountries?.length ?? 0) === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["geoCountries"], message: "Choose at least one country for this geographic availability mode." });
  }
  if (value.chapters) {
    for (let index = 1; index < value.chapters.length; index += 1) {
      if (value.chapters[index]!.startSeconds <= value.chapters[index - 1]!.startSeconds) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["chapters", index, "startSeconds"], message: "Chapter start times must be strictly increasing." });
      }
    }
  }
  if (value.adBreakPreference === "CUSTOM" && (value.adBreakOffsetsSeconds?.length ?? 0) === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["adBreakOffsetsSeconds"], message: "Add at least one offset for custom ad breaks." });
  }
  if (value.adBreakPreference !== "CUSTOM" && (value.adBreakOffsetsSeconds?.length ?? 0) > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["adBreakOffsetsSeconds"], message: "Ad-break offsets are only used with the custom preference." });
  }
});

export type VideoMetadataInput = z.infer<typeof videoMetadataSchema>;

export function validateMetadataDuration(input: VideoMetadataInput, durationMs: number | null): void {
  if (!durationMs || durationMs <= 0) return;
  const durationSeconds = durationMs / 1000;
  if (input.chapters?.some((chapter) => chapter.startSeconds >= durationSeconds)) throw new Error("CHAPTER_OUTSIDE_VIDEO");
  if (input.adBreakOffsetsSeconds?.some((offset) => offset >= durationSeconds)) throw new Error("AD_BREAK_OUTSIDE_VIDEO");
}

export function metadataData(input: VideoMetadataInput) {
  return {
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.primaryLanguage !== undefined ? { primaryLanguage: input.primaryLanguage } : {}),
    ...(input.recordingDate !== undefined ? { recordingDate: input.recordingDate ? new Date(`${input.recordingDate}T00:00:00.000Z`) : null } : {}),
    ...(input.seriesTitle !== undefined ? { seriesTitle: input.seriesTitle } : {}),
    ...(input.seasonNumber !== undefined ? { seasonNumber: input.seasonNumber } : {}),
    ...(input.episodeNumber !== undefined ? { episodeNumber: input.episodeNumber } : {}),
    ...(input.chapters !== undefined ? { chapters: input.chapters } : {}),
    ...(input.adBreakPreference !== undefined ? { adBreakPreference: input.adBreakPreference } : {}),
    ...(input.adBreakOffsetsSeconds !== undefined ? { adBreakOffsetsSeconds: input.adBreakOffsetsSeconds } : {}),
  };
}

export function policyData(input: VideoMetadataInput) {
  const data: Record<string, unknown> = {};
  if (input.maturityLevel !== undefined) data.maturityLevel = input.maturityLevel;
  if (input.ageRestriction !== undefined) data.ageRestriction = input.ageRestriction ?? "NONE";
  if (input.rightsExpiresAt !== undefined) data.rightsExpiresAt = input.rightsExpiresAt ? new Date(input.rightsExpiresAt) : null;
  if (input.allowedTerritories !== undefined) data.allowedTerritories = input.allowedTerritories;
  if (input.blockedTerritories !== undefined) data.blockedTerritories = input.blockedTerritories;
  if (input.geoAvailabilityMode !== undefined || input.geoCountries !== undefined) {
    const countries = input.geoCountries ?? [];
    if (input.geoAvailabilityMode === "INCLUDE_ONLY") {
      data.allowedTerritories = countries;
      data.blockedTerritories = [];
    } else if (input.geoAvailabilityMode === "EXCLUDE") {
      data.allowedTerritories = [];
      data.blockedTerritories = countries;
    } else {
      data.allowedTerritories = [];
      data.blockedTerritories = [];
    }
  }
  return data;
}

export function hasCompanionMetadata(input: VideoMetadataInput): boolean {
  return ["tags", "category", "primaryLanguage", "recordingDate", "seriesTitle", "seasonNumber", "episodeNumber", "chapters", "adBreakPreference", "adBreakOffsetsSeconds"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

export function hasPolicyMetadata(input: VideoMetadataInput): boolean {
  return ["maturityLevel", "ageRestriction", "rightsExpiresAt", "allowedTerritories", "blockedTerritories", "geoAvailabilityMode", "geoCountries"].some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

export function hasAnyAdvancedMetadata(input: VideoMetadataInput): boolean {
  return hasCompanionMetadata(input) || hasPolicyMetadata(input) || input.contentType !== undefined || input.rightsBasis !== undefined || input.rightsNote !== undefined;
}
''')

# Policy-aware metadata persistence while keeping rights declarations legally intact.
write("apps/api/src/creator/video-metadata.service.ts", r'''import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  hasCompanionMetadata,
  hasPolicyMetadata,
  metadataData,
  policyData,
  type VideoMetadataInput,
  validateMetadataDuration,
} from "./video-metadata.validation.js";

const CREATOR_RIGHTS_NOTE_SEPARATOR = "\n\nCreator note: ";

export class VideoMetadataError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) {
    super(message);
    this.name = "VideoMetadataError";
  }
}

@Injectable()
export class VideoMetadataService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async applyForOwner(accountId: string, videoId: string, input: VideoMetadataInput) {
    const video = await this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true, channelId: true, durationMs: true, status: true } });
    if (!video) throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    const membership = await this.database.client.channelMember.findFirst({ where: { accountId, channelId: video.channelId, role: "OWNER" }, select: { id: true } });
    if (!membership) throw new VideoMetadataError("VIDEO_OWNER_REQUIRED", "Only the channel owner can manage this video.", 403);
    if (video.status === "REMOVED") throw new VideoMetadataError("VIDEO_REMOVED", "This video can no longer be edited.", 409);
    return this.apply(video.id, video.durationMs, input);
  }

  async applyForStudio(accountId: string, videoId: string, input: VideoMetadataInput) {
    const video = await this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true, channelId: true, durationMs: true, status: true } });
    if (!video) throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video is not available in your Studio.", 404);
    const membership = await this.database.client.channelMember.findFirst({ where: { accountId, channelId: video.channelId, role: { in: ["OWNER", "ADMIN", "EDITOR"] } }, select: { role: true } });
    if (!membership) throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video is not available in your Studio.", 404);
    if (video.status === "REMOVED") throw new VideoMetadataError("VIDEO_REMOVED", "This video can no longer be edited.", 409);
    if (input.rightsExpiresAt !== undefined && membership.role !== "OWNER") {
      throw new VideoMetadataError("RIGHTS_OWNER_REQUIRED", "Only the channel owner can change distribution-rights expiry.", 403);
    }
    return this.apply(video.id, video.durationMs, input);
  }

  async updateRightsForOwner(accountId: string, videoId: string, input: VideoMetadataInput) {
    if (input.rightsBasis === undefined && input.rightsNote === undefined) return;
    const video = await this.database.client.video.findFirst({ where: { id: videoId, channel: { members: { some: { accountId, role: "OWNER" } } } }, select: { id: true } });
    if (!video) throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    const declaration = await this.database.client.contentRightsDeclaration.findFirst({ where: { videoId, status: "CONFIRMED" }, orderBy: { version: "desc" }, select: { id: true, statement: true } });
    if (!declaration) return;
    await this.database.client.contentRightsDeclaration.update({
      where: { id: declaration.id },
      data: {
        ...(input.rightsBasis !== undefined ? { basis: input.rightsBasis } : {}),
        ...(input.rightsNote !== undefined ? { statement: withCreatorRightsNote(declaration.statement ?? "", input.rightsNote) } : {}),
      },
    });
  }

  async readOne(videoId: string) {
    const [video, metadata, policy, rights] = await Promise.all([
      this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true, contentType: true } }),
      this.database.client.videoCreatorMetadata.findUnique({ where: { videoId } }),
      this.database.client.videoPolicy.findUnique({ where: { videoId } }),
      this.database.client.contentRightsDeclaration.findFirst({ where: { videoId, status: "CONFIRMED" }, orderBy: { version: "desc" }, select: { basis: true, statement: true } }),
    ]);
    if (!video) return null;
    return compose(video.contentType, metadata, policy, rights);
  }

  async readMany(videoIds: string[]) {
    const ids = [...new Set(videoIds)];
    if (!ids.length) return new Map();
    const [videos, metadata, policies, rights] = await Promise.all([
      this.database.client.video.findMany({ where: { id: { in: ids } }, select: { id: true, contentType: true } }),
      this.database.client.videoCreatorMetadata.findMany({ where: { videoId: { in: ids } } }),
      this.database.client.videoPolicy.findMany({ where: { videoId: { in: ids } } }),
      this.database.client.contentRightsDeclaration.findMany({ where: { videoId: { in: ids }, status: "CONFIRMED" }, orderBy: [{ videoId: "asc" }, { version: "desc" }], select: { videoId: true, basis: true, statement: true, version: true } }),
    ]);
    const metadataByVideo = new Map(metadata.map((item) => [item.videoId, item]));
    const policyByVideo = new Map(policies.map((item) => [item.videoId, item]));
    const rightsByVideo = new Map<string, (typeof rights)[number]>();
    for (const declaration of rights) if (!rightsByVideo.has(declaration.videoId)) rightsByVideo.set(declaration.videoId, declaration);
    return new Map(videos.map((video) => [video.id, compose(video.contentType, metadataByVideo.get(video.id), policyByVideo.get(video.id), rightsByVideo.get(video.id))] as const));
  }

  private async apply(videoId: string, durationMs: number | null, input: VideoMetadataInput) {
    try { validateMetadataDuration(input, durationMs); } catch (error) {
      if (error instanceof Error && error.message === "CHAPTER_OUTSIDE_VIDEO") throw new VideoMetadataError("CHAPTER_OUTSIDE_VIDEO", "Every chapter must start before the video ends.");
      if (error instanceof Error && error.message === "AD_BREAK_OUTSIDE_VIDEO") throw new VideoMetadataError("AD_BREAK_OUTSIDE_VIDEO", "Every custom ad break must occur before the video ends.");
      throw error;
    }
    if (input.contentType === undefined && !hasCompanionMetadata(input) && !hasPolicyMetadata(input)) return this.readOne(videoId);
    await this.database.client.$transaction(async (tx) => {
      if (input.contentType !== undefined) await tx.video.update({ where: { id: videoId }, data: { contentType: input.contentType } });
      if (hasCompanionMetadata(input)) {
        const data = metadataData(input);
        const { chapters, ...scalarData } = data;
        const prismaData = { ...scalarData, ...(chapters !== undefined ? { chapters: chapters === null ? Prisma.JsonNull : chapters } : {}) };
        await tx.videoCreatorMetadata.upsert({ where: { videoId }, create: { videoId, ...prismaData }, update: prismaData });
      }
      if (hasPolicyMetadata(input)) {
        const data = policyData(input);
        await tx.videoPolicy.upsert({ where: { videoId }, create: { videoId, ...data }, update: data });
      }
    });
    return this.readOne(videoId);
  }
}

function compose(contentType: string, metadata: any, policy: any, rights: any) {
  const allowedTerritories = policy?.allowedTerritories ?? (metadata?.geoAvailabilityMode === "INCLUDE_ONLY" ? metadata.geoCountries : []);
  const blockedTerritories = policy?.blockedTerritories ?? (metadata?.geoAvailabilityMode === "EXCLUDE" ? metadata.geoCountries : []);
  const geoAvailabilityMode = allowedTerritories.length ? "INCLUDE_ONLY" : blockedTerritories.length ? "EXCLUDE" : policy ? "WORLDWIDE" : (metadata?.geoAvailabilityMode ?? null);
  const geoCountries = allowedTerritories.length ? allowedTerritories : blockedTerritories;
  return {
    contentType,
    tags: metadata?.tags ?? [], category: metadata?.category ?? null, primaryLanguage: metadata?.primaryLanguage ?? null,
    recordingDate: metadata?.recordingDate?.toISOString().slice(0, 10) ?? null,
    seriesTitle: metadata?.seriesTitle ?? null, seasonNumber: metadata?.seasonNumber ?? null, episodeNumber: metadata?.episodeNumber ?? null,
    maturityLevel: policy?.maturityLevel ?? metadata?.maturityLevel ?? null,
    ageRestriction: policy?.ageRestriction ?? "NONE",
    allowedTerritories, blockedTerritories,
    rightsExpiresAt: policy?.rightsExpiresAt?.toISOString() ?? null,
    geoAvailabilityMode, geoCountries,
    chapters: metadata?.chapters ?? [], adBreakPreference: metadata?.adBreakPreference ?? null, adBreakOffsetsSeconds: metadata?.adBreakOffsetsSeconds ?? [],
    rightsBasis: rights?.basis ?? null, rightsNote: creatorRightsNote(rights?.statement),
  };
}

function creatorRightsNote(statement: string | null | undefined): string | null {
  if (!statement) return null;
  const index = statement.indexOf(CREATOR_RIGHTS_NOTE_SEPARATOR);
  if (index < 0) return null;
  return statement.slice(index + CREATOR_RIGHTS_NOTE_SEPARATOR.length).trim() || null;
}
function withCreatorRightsNote(statement: string, note: string | null): string {
  const index = statement.indexOf(CREATOR_RIGHTS_NOTE_SEPARATOR);
  const attestation = (index < 0 ? statement : statement.slice(0, index)).trim();
  return note?.trim() ? `${attestation}${CREATOR_RIGHTS_NOTE_SEPARATOR}${note.trim()}` : attestation;
}
''')

# Player authorization: policy is enforced after hard publication/visibility boundaries.
replace(
    "apps/api/src/watch/watch.service.ts",
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\n',
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\nimport { VideoPolicyService } from "../video-policy/video-policy.service.js";\n',
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,\n  ) {}",
    "    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n  ) {}",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "  async getPublicPlayback(slug: string) {",
    "  async getPublicPlayback(slug: string, countryCode?: string) {",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "    const source = video.mediaAssets.find(\n",
    "    const availability = await this.videoPolicy.decide(video.id, { countryCode });\n    if (!availability.allowed) {\n      throw new WatchError(\"VIDEO_NOT_FOUND\", \"This AYIN video could not be found.\", 404);\n    }\n\n    const source = video.mediaAssets.find(\n",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "    const adaptiveSource =\n",
    "    const allowedRelatedIds = await this.videoPolicy.filterAvailableVideoIds(related.map((item) => item.id), { countryCode });\n\n    const adaptiveSource =\n",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "        related: related.map((item) => ({\n",
    "        policy: { maturityLevel: availability.maturityLevel, ageRestriction: availability.ageRestriction },\n        related: related.filter((item) => allowedRelatedIds.has(item.id)).map((item) => ({\n",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "  async getProgress(accountId: string, videoId: string, profileId?: string) {\n    const profile = await this.resolveProfile(accountId, profileId);\n    await this.assertPlayableVideo(videoId);",
    "  async getProgress(accountId: string, videoId: string, profileId?: string, countryCode?: string) {\n    const profile = await this.resolveProfile(accountId, profileId);\n    await this.assertPlayableVideo(videoId, countryCode, profile.isKids);",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "  async saveProgress(accountId: string, videoId: string, input: SaveWatchProgressInput) {\n    const [profile, video, policy] = await Promise.all([\n      this.resolveProfile(accountId, input.profileId),\n      this.findPlayableVideo(videoId),\n      this.getPlayerPolicy(),\n    ]);",
    "  async saveProgress(accountId: string, videoId: string, input: SaveWatchProgressInput, countryCode?: string) {\n    const profile = await this.resolveProfile(accountId, input.profileId);\n    const [video, policy] = await Promise.all([\n      this.findPlayableVideo(videoId, countryCode, profile.isKids),\n      this.getPlayerPolicy(),\n    ]);",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "          select: { id: true },\n        })\n      : await this.database.client.viewerProfile.findFirst({",
    "          select: { id: true, isKids: true },\n        })\n      : await this.database.client.viewerProfile.findFirst({",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "          select: { id: true },\n        });\n",
    "          select: { id: true, isKids: true },\n        });\n",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "  private async assertPlayableVideo(videoId: string): Promise<void> {\n    await this.findPlayableVideo(videoId);\n  }\n\n  private async findPlayableVideo(videoId: string) {",
    "  private async assertPlayableVideo(videoId: string, countryCode?: string, isKidsProfile?: boolean): Promise<void> {\n    await this.findPlayableVideo(videoId, countryCode, isKidsProfile);\n  }\n\n  private async findPlayableVideo(videoId: string, countryCode?: string, isKidsProfile?: boolean) {",
)
replace(
    "apps/api/src/watch/watch.service.ts",
    "    if (!video) {\n      throw new WatchError(\"VIDEO_NOT_FOUND\", \"This AYIN video could not be found.\", 404);\n    }\n    return video;\n  }",
    "    if (!video) {\n      throw new WatchError(\"VIDEO_NOT_FOUND\", \"This AYIN video could not be found.\", 404);\n    }\n    const availability = await this.videoPolicy.decide(video.id, { countryCode, isKidsProfile });\n    if (!availability.allowed) {\n      throw new WatchError(\"VIDEO_NOT_FOUND\", \"This AYIN video could not be found.\", 404);\n    }\n    return video;\n  }",
)

# Trusted region passed by watch controller; personalization headers never participate.
replace(
    "apps/api/src/watch/watch.controller.ts",
    "  Body,\n  Controller,\n  Get,",
    "  Body,\n  Controller,\n  Get,\n  Headers,",
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\n',
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\nimport { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";\n',
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "  constructor(@Inject(WatchService) private readonly watch: WatchService) {}\n\n  @Get(\":slug/playback\")\n  async playback(@Param(\"slug\") slug: string) {\n    return runWatchOperation(() => this.watch.getPublicPlayback(slug));",
    "  constructor(\n    @Inject(WatchService) private readonly watch: WatchService,\n    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,\n  ) {}\n\n  @Get(\":slug/playback\")\n  async playback(@Param(\"slug\") slug: string, @Headers() headers: HeaderBag) {\n    return runWatchOperation(() => this.watch.getPublicPlayback(slug, this.trustedRegion.countryFromHeaders(headers)));",
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "  constructor(@Inject(WatchService) private readonly watch: WatchService) {}",
    "  constructor(\n    @Inject(WatchService) private readonly watch: WatchService,\n    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,\n  ) {}",
    1,
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "    @Query() query: unknown,\n  ) {",
    "    @Query() query: unknown,\n    @Headers() headers: HeaderBag,\n  ) {",
    1,
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "      this.watch.getProgress(request.ayinAuth.accountId, videoId, parsed.data.profileId),",
    "      this.watch.getProgress(request.ayinAuth.accountId, videoId, parsed.data.profileId, this.trustedRegion.countryFromHeaders(headers)),",
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "    @Body() body: unknown,\n  ) {",
    "    @Body() body: unknown,\n    @Headers() headers: HeaderBag,\n  ) {",
    1,
)
replace(
    "apps/api/src/watch/watch.controller.ts",
    "      this.watch.saveProgress(request.ayinAuth.accountId, videoId, parsed.data),",
    "      this.watch.saveProgress(request.ayinAuth.accountId, videoId, parsed.data, this.trustedRegion.countryFromHeaders(headers)),",
)

# Discovery: retain client region only for personalization, use trusted region separately for policy.
replace(
    "apps/api/src/discovery/discovery.service.ts",
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { VideoPolicyService } from "../video-policy/video-policy.service.js";\n',
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "  regionPersonalizationAllowed?: boolean | undefined;\n}",
    "  regionPersonalizationAllowed?: boolean | undefined;\n  availabilityCountryCode?: string | undefined;\n  isKidsProfile?: boolean | undefined;\n}",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "    @Inject(HomeRowConfigService) private readonly rows: HomeRowConfigService,\n  ) {}",
    "    @Inject(HomeRowConfigService) private readonly rows: HomeRowConfigService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n  ) {}",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "          ...(await this.loadRowPage(row, normalized, 0, Math.min(firstPageSize, row.maxItems))),",
    "          ...(await this.enforcePage(await this.loadRowPage(row, normalized, 0, Math.min(firstPageSize, row.maxItems)), normalized)),",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "      ...(await this.loadRowPage(row, normalized, offset, limit)),",
    "      ...(await this.enforcePage(await this.loadRowPage(row, normalized, offset, limit), normalized)),",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "  async getMyAyin(accountId: string, requestedProfileId?: string) {\n    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId });",
    "  async getMyAyin(accountId: string, requestedProfileId?: string, availabilityCountryCode?: string) {\n    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId, availabilityCountryCode });",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "        { key: \"continue-watching\", title: \"Continue Watching\", ...continueWatching },\n        { key: \"my-list\", title: \"My List\", ...myList },\n        { key: \"watch-later\", title: \"Watch Later\", ...watchLater },\n        { key: \"history\", title: \"Watch History\", ...history },\n        { key: \"liked\", title: \"Liked Content\", ...liked },",
    "        { key: \"continue-watching\", title: \"Continue Watching\", ...(await this.enforcePage(continueWatching, context)) },\n        { key: \"my-list\", title: \"My List\", ...(await this.enforcePage(myList, context)) },\n        { key: \"watch-later\", title: \"Watch Later\", ...(await this.enforcePage(watchLater, context)) },\n        { key: \"history\", title: \"Watch History\", ...(await this.enforcePage(history, context)) },\n        { key: \"liked\", title: \"Liked Content\", ...(await this.enforcePage(liked, context)) },",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "    requestedLimit?: number,\n  ) {\n    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId });",
    "    requestedLimit?: number,\n    availabilityCountryCode?: string,\n  ) {\n    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId, availabilityCountryCode });",
)
# Wrap My AYIN section switch results.
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "        return this.loadContinueWatching(context.profileId, offset, limit);",
    "        return this.enforcePage(await this.loadContinueWatching(context.profileId, offset, limit), context);",
)
replace("apps/api/src/discovery/discovery.service.ts", "        return this.loadWatchLater(context.profileId, offset, limit);", "        return this.enforcePage(await this.loadWatchLater(context.profileId, offset, limit), context);")
replace("apps/api/src/discovery/discovery.service.ts", "        return this.loadHistory(context.profileId, offset, limit);", "        return this.enforcePage(await this.loadHistory(context.profileId, offset, limit), context);")
replace("apps/api/src/discovery/discovery.service.ts", "        return this.loadLiked(context.profileId, offset, limit);", "        return this.enforcePage(await this.loadLiked(context.profileId, offset, limit), context);")
replace("apps/api/src/discovery/discovery.service.ts", "        return this.loadMyList(context.profileId, offset, limit);", "        return this.enforcePage(await this.loadMyList(context.profileId, offset, limit), context);")
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "          select: { id: true },\n        })\n      : await this.database.client.viewerProfile.findFirst({",
    "          select: { id: true, isKids: true },\n        })\n      : await this.database.client.viewerProfile.findFirst({",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "          select: { id: true },\n        });",
    "          select: { id: true, isKids: true },\n        });",
)
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "      regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,\n    };",
    "      regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,\n      availabilityCountryCode: context.availabilityCountryCode,\n      isKidsProfile: profile.isKids,\n    };",
    1,
)
# Anonymous normalize branch needs availability passthrough.
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "        regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,\n      };",
    "        regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,\n        availabilityCountryCode: context.availabilityCountryCode,\n      };",
    1,
)
# Add enforcement helper before loadRowPage.
replace(
    "apps/api/src/discovery/discovery.service.ts",
    "  private async loadRowPage(\n",
    "  private async enforcePage(page: DiscoveryPage, context: DiscoveryContext): Promise<DiscoveryPage> {\n    const videoIds = page.items.filter((item) => item.type === \"VIDEO\").map((item) => item.id);\n    if (!videoIds.length) return page;\n    const allowed = await this.videoPolicy.filterAvailableVideoIds(videoIds, {\n      countryCode: context.availabilityCountryCode,\n      isKidsProfile: context.isKidsProfile,\n    });\n    return { ...page, items: page.items.filter((item) => item.type !== \"VIDEO\" || allowed.has(item.id)) };\n  }\n\n  private async loadRowPage(\n",
)

# Discovery controllers derive policy country from trusted headers, never x-ayin-region.
replace(
    "apps/api/src/discovery/discovery.controller.ts",
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\n',
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\nimport { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";\n',
)
replace(
    "apps/api/src/discovery/discovery.controller.ts",
    "  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}",
    "  constructor(\n    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,\n    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,\n  ) {}",
    1,
)
replace(
    "apps/api/src/discovery/discovery.controller.ts",
    "    @Headers(\"x-ayin-region-personalization\") regionalPermission?: string,\n  ) {\n    return runDiscovery(() =>\n      this.discovery.getHome(regionContext(regionCode, regionalPermission)),",
    "    @Headers(\"x-ayin-region-personalization\") regionalPermission?: string,\n    @Headers() headers?: HeaderBag,\n  ) {\n    return runDiscovery(() =>\n      this.discovery.getHome({ ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers ?? {}) }),",
)
replace(
    "apps/api/src/discovery/discovery.controller.ts",
    "        regionContext(regionCode, regionalPermission),\n        parsed.cursor,",
    "        { ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders((arguments as never) as HeaderBag) },\n        parsed.cursor,",
)
# Undo the awkward row replacement by directly rewrite controller later below.

write("apps/api/src/discovery/discovery.controller.ts", r'''import { Controller, Get, Headers, HttpException, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { DiscoveryError, DiscoveryService, type DiscoveryContext } from "./discovery.service.js";

const listQuerySchema = z.object({ profileId: z.string().uuid().optional(), cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(24).optional() }).strict();

@Controller("public/discovery")
export class PublicDiscoveryController {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}
  @Get("home")
  async home(@Headers("x-ayin-region") regionCode: string | undefined, @Headers("x-ayin-region-personalization") regionalPermission: string | undefined, @Headers() headers: HeaderBag) {
    return runDiscovery(() => this.discovery.getHome({ ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) }));
  }
  @Get("rows/:key")
  async row(@Param("key") key: string, @Query() query: unknown, @Headers("x-ayin-region") regionCode: string | undefined, @Headers("x-ayin-region-personalization") regionalPermission: string | undefined, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(() => this.discovery.getRow(key, { ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) }, parsed.cursor, parsed.limit));
  }
}

@Controller("discovery")
@UseGuards(AuthGuard)
export class DiscoveryController {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}
  @Get("home")
  async home(@Req() request: AuthenticatedRequest, @Query() query: unknown, @Headers("x-ayin-region") regionCode: string | undefined, @Headers("x-ayin-region-personalization") regionalPermission: string | undefined, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(() => this.discovery.getHome({ accountId: request.ayinAuth.accountId, profileId: parsed.profileId, ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) }));
  }
  @Get("rows/:key")
  async row(@Req() request: AuthenticatedRequest, @Param("key") key: string, @Query() query: unknown, @Headers("x-ayin-region") regionCode: string | undefined, @Headers("x-ayin-region-personalization") regionalPermission: string | undefined, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(() => this.discovery.getRow(key, { accountId: request.ayinAuth.accountId, profileId: parsed.profileId, ...regionContext(regionCode, regionalPermission), availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) }, parsed.cursor, parsed.limit));
  }
  @Get("my-ayin")
  async myAyin(@Req() request: AuthenticatedRequest, @Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(() => this.discovery.getMyAyin(request.ayinAuth.accountId, parsed.profileId, this.trustedRegion.countryFromHeaders(headers)));
  }
  @Get("my-ayin/:section")
  async myAyinSection(@Req() request: AuthenticatedRequest, @Param("section") section: string, @Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(() => this.discovery.getMyAyinSection(request.ayinAuth.accountId, section, parsed.profileId, parsed.cursor, parsed.limit, this.trustedRegion.countryFromHeaders(headers)));
  }
}

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) throw discoveryHttpError(new DiscoveryError("INVALID_DISCOVERY_QUERY", "The discovery request is invalid."));
  return parsed.data;
}
function regionContext(regionCode?: string, regionalPermission?: string): DiscoveryContext {
  return { ...(regionCode ? { regionCode } : {}), regionPersonalizationAllowed: regionalPermission === "allow" };
}
async function runDiscovery<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw discoveryHttpError(error); }
}
function discoveryHttpError(error: unknown): Error {
  if (error instanceof DiscoveryError) return new HttpException({ error: { code: error.code, message: error.message } }, error.statusCode);
  return error instanceof Error ? error : new Error("Unexpected discovery error.");
}
''')

# Search + Lens policy filtering.
replace(
    "apps/api/src/search/search.service.ts",
    'import { VIDEO_CATEGORIES } from "../creator/video-metadata.validation.js";\n',
    'import { VIDEO_CATEGORIES } from "../creator/video-metadata.validation.js";\nimport { VideoPolicyService, type VideoPolicyContext } from "../video-policy/video-policy.service.js";\n',
)
replace(
    "apps/api/src/search/search.service.ts",
    "  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}",
    "  constructor(\n    @Inject(DatabaseService) private readonly database: DatabaseService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n  ) {}",
)
replace(
    "apps/api/src/search/search.service.ts",
    "  async search(query: string, cursor?: string, requestedLimit = 12) {",
    "  async search(query: string, cursor?: string, requestedLimit = 12, context: VideoPolicyContext = {}) {",
)
replace(
    "apps/api/src/search/search.service.ts",
    "    const ranked: SearchResult[] = [\n      ...videos.map((video) => ({",
    "    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(videos.map((video) => video.id), context);\n    const ranked: SearchResult[] = [\n      ...videos.filter((video) => allowedVideoIds.has(video.id)).map((video) => ({",
)
replace(
    "apps/api/src/search/search.service.ts",
    "  async suggest(query: string, requestedLimit = 6) {",
    "  async suggest(query: string, requestedLimit = 6, context: VideoPolicyContext = {}) {",
)
replace(
    "apps/api/src/search/search.service.ts",
    "    return {\n      query: normalized,\n      suggestions: [\n        ...videos.map((video) => ({",
    "    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(videos.map((video) => video.id), context);\n    return {\n      query: normalized,\n      suggestions: [\n        ...videos.filter((video) => allowedVideoIds.has(video.id)).map((video) => ({",
)
replace(
    "apps/api/src/search/search.service.ts",
    "}\n\nfunction normalizeQuery",
    "\n  async filterResults(items: SearchResult[], context: VideoPolicyContext = {}) {\n    const videoIds = items.filter((item) => item.type === \"VIDEO\").map((item) => item.id);\n    if (!videoIds.length) return items;\n    const allowed = await this.videoPolicy.filterAvailableVideoIds(videoIds, context);\n    return items.filter((item) => item.type !== \"VIDEO\" || allowed.has(item.id));\n  }\n}\n\nfunction normalizeQuery",
)

write("apps/api/src/search/search.controller.ts", r'''import { Controller, Get, Headers, HttpException, Inject, Query, Req } from "@nestjs/common";
import { z } from "zod";

import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { LensSearchService } from "./lens-search.service.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchError, SearchService } from "./search.service.js";

const searchSchema = z.object({ q: z.string(), cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(24).optional() }).strict();
const suggestSchema = z.object({ q: z.string(), limit: z.coerce.number().int().min(1).max(8).optional() }).strict();

@Controller("public/search")
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
    @Inject(LensSearchService) private readonly lensSearch: LensSearchService,
    @Inject(SearchRateLimiter) private readonly rateLimiter: SearchRateLimiter,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}
  @Get()
  async search(@Req() request: { ip?: string }, @Query() query: unknown, @Headers() headers: HeaderBag) {
    return runSearch(() => {
      this.rateLimiter.consume(`search:${request.ip ?? "unknown"}`);
      const parsed = searchSchema.safeParse(query);
      if (!parsed.success) throw new SearchError("INVALID_SEARCH_QUERY", "The search request is invalid.");
      return this.searchService.search(parsed.data.q, parsed.data.cursor, parsed.data.limit, { countryCode: this.trustedRegion.countryFromHeaders(headers) });
    });
  }
  @Get("lens")
  async lens(@Req() request: { ip?: string }, @Query() query: unknown, @Headers() headers: HeaderBag) {
    return runSearch(() => {
      this.rateLimiter.consume(`lens:${request.ip ?? "unknown"}`);
      const parsed = searchSchema.safeParse(query);
      if (!parsed.success) throw new SearchError("INVALID_SEARCH_QUERY", "The Lens search request is invalid.");
      return this.lensSearch.searchLens(parsed.data.q, parsed.data.limit, { countryCode: this.trustedRegion.countryFromHeaders(headers) });
    });
  }
  @Get("suggestions")
  async suggestions(@Req() request: { ip?: string }, @Query() query: unknown, @Headers() headers: HeaderBag) {
    return runSearch(() => {
      this.rateLimiter.consume(`suggest:${request.ip ?? "unknown"}`);
      const parsed = suggestSchema.safeParse(query);
      if (!parsed.success) throw new SearchError("INVALID_SEARCH_QUERY", "The suggestion request is invalid.");
      return this.searchService.suggest(parsed.data.q, parsed.data.limit, { countryCode: this.trustedRegion.countryFromHeaders(headers) });
    });
  }
}
async function runSearch<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof SearchError) throw new HttpException({ error: { code: error.code, message: error.message } }, error.statusCode);
    throw error instanceof Error ? error : new Error("Unexpected search error.");
  }
}
''')

replace(
    "apps/api/src/search/lens-search.service.ts",
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\n',
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\nimport type { VideoPolicyContext } from "../video-policy/video-policy.service.js";\n',
)
replace("apps/api/src/search/lens-search.service.ts", "  async searchLens(query: string, limit = 12) {", "  async searchLens(query: string, limit = 12, context: VideoPolicyContext = {}) {")
replace(
    "apps/api/src/search/lens-search.service.ts",
    "      const items = await this.provider.search(query, Math.min(Math.max(limit, 1), 24));\n      return {",
    "      const providerItems = await this.provider.search(query, Math.min(Math.max(limit, 1), 24));\n      const items = await this.search.filterResults(providerItems, context);\n      return {",
)
replace("apps/api/src/search/lens-search.service.ts", "    const fallback = await this.search.search(query, undefined, limit);", "    const fallback = await this.search.search(query, undefined, limit, context);")

# Creator TV public schedule filters both auto library and admin schedule overrides.
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\n',
    'import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";\nimport { VideoPolicyService, type VideoPolicyContext } from "../video-policy/video-policy.service.js";\n',
)
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    "    @Inject(CREATOR_TV_AD_BREAK_HOOK) private readonly adBreakHook: CreatorTvAdBreakHook,\n  ) {}",
    "    @Inject(CREATOR_TV_AD_BREAK_HOOK) private readonly adBreakHook: CreatorTvAdBreakHook,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n  ) {}",
)
replace("apps/api/src/creator/creator-tv.service.ts", "  async getPublicTv(handleRaw: string, now = new Date()) {", "  async getPublicTv(handleRaw: string, now = new Date(), policyContext: VideoPolicyContext = {}) {")
replace("apps/api/src/creator/creator-tv.service.ts", "    const library = await this.loadEligibleLibrary(tv.id, tv.channelId);", "    const library = await this.loadEligibleLibrary(tv.id, tv.channelId, false, policyContext);")
replace("apps/api/src/creator/creator-tv.service.ts", "    const overrides = await this.loadAdminOverrides(tv.id, now, new Date(automatic.windowEndsAtMs));", "    const overrides = await this.loadAdminOverrides(tv.id, now, new Date(automatic.windowEndsAtMs), policyContext);")
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    "    includeExcluded = false,\n  ): Promise<",
    "    includeExcluded = false,\n    policyContext?: VideoPolicyContext,\n  ): Promise<",
)
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    "    return videos.flatMap((video) => {",
    "    const allowedVideoIds = policyContext ? await this.videoPolicy.filterAvailableVideoIds(videos.map((video) => video.id), policyContext) : new Set(videos.map((video) => video.id));\n    return videos.flatMap((video) => {\n      if (!allowedVideoIds.has(video.id)) return [];",
    1,
)
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    "    until: Date,\n  ): Promise<TvProgram[]> {",
    "    until: Date,\n    policyContext: VideoPolicyContext,\n  ): Promise<TvProgram[]> {",
)
replace(
    "apps/api/src/creator/creator-tv.service.ts",
    "    return items.flatMap((item) => {",
    "    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(items.map((item) => item.video.id), policyContext);\n    return items.flatMap((item) => {\n      if (!allowedVideoIds.has(item.video.id)) return [];",
    1,
)

# Public TV controller receives the same trusted region authority as playback.
replace(
    "apps/api/src/creator/creator-tv.controller.ts",
    "  Get,\n  HttpException,",
    "  Get,\n  Headers,\n  HttpException,",
)
replace(
    "apps/api/src/creator/creator-tv.controller.ts",
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\n',
    'import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";\nimport { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";\n',
)
replace(
    "apps/api/src/creator/creator-tv.controller.ts",
    "    @Inject(CreatorTvLinearService) private readonly linear: CreatorTvLinearService,\n  ) {}\n\n  @Get(\":handle/tv\")\n  async getTv(@Param(\"handle\") handle: string) {\n    return runTvOperation(() => this.creatorTv.getPublicTv(handle));",
    "    @Inject(CreatorTvLinearService) private readonly linear: CreatorTvLinearService,\n    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,\n  ) {}\n\n  @Get(\":handle/tv\")\n  async getTv(@Param(\"handle\") handle: string, @Headers() headers: HeaderBag) {\n    return runTvOperation(() => this.creatorTv.getPublicTv(handle, new Date(), { countryCode: this.trustedRegion.countryFromHeaders(headers) }));",
)

# SEO authoritative policy decisions.
replace(
    "apps/api/src/seo/seo.service.ts",
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { DatabaseService } from "../database/database.service.js";\nimport { VideoPolicyService, type VideoPolicyContext } from "../video-policy/video-policy.service.js";\n',
)
replace(
    "apps/api/src/seo/seo.service.ts",
    "  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}",
    "  constructor(\n    @Inject(DatabaseService) private readonly database: DatabaseService,\n    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,\n  ) {}",
)
replace("apps/api/src/seo/seo.service.ts", "  async getVideo(slug: string) {", "  async getVideo(slug: string, context: VideoPolicyContext = {}) {")
replace(
    "apps/api/src/seo/seo.service.ts",
    "    const thumbnail = video.mediaAssets.find((asset) => asset.kind === \"THUMBNAIL\");",
    "    const availability = await this.videoPolicy.decide(video.id, context);\n    if (!availability.allowed) throw new NotFoundException(\"This video is not available for SEO metadata.\");\n\n    const thumbnail = video.mediaAssets.find((asset) => asset.kind === \"THUMBNAIL\");",
    1,
)
# Sitemap globally safe filtering.
replace(
    "apps/api/src/seo/seo.service.ts",
    "    return {\n      items: videos.map((video) => {",
    "    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(videos.map((video) => video.id), {});\n    return {\n      items: videos.filter((video) => allowedVideoIds.has(video.id)).map((video) => {",
    1,
)
# Playlist SEO: filter item video ids conservatively.
replace(
    "apps/api/src/seo/seo.service.ts",
    "    return {\n      id: playlist.id,\n      slug: playlist.slug,",
    "    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(playlist.items.map((item) => item.video.id), {});\n    return {\n      id: playlist.id,\n      slug: playlist.slug,",
    1,
)
replace(
    "apps/api/src/seo/seo.service.ts",
    "      items: playlist.items.map((item) => ({",
    "      items: playlist.items.filter((item) => allowedVideoIds.has(item.video.id)).map((item) => ({",
    1,
)

write("apps/api/src/seo/seo.controller.ts", r'''import { BadRequestException, Controller, Get, Headers, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { SeoService, type SeoSitemapKind } from "./seo.service.js";

const sitemapQuerySchema = z.object({ offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0), limit: z.coerce.number().int().min(1).max(5_000).default(1_000) }).strict();
const sitemapKinds = new Set<SeoSitemapKind>(["videos", "channels", "playlists"]);

@Controller("public/seo")
export class SeoController {
  constructor(
    @Inject(SeoService) private readonly seo: SeoService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}
  @Get("videos/:slug")
  getVideo(@Param("slug") slug: string, @Headers() headers: HeaderBag) {
    return this.seo.getVideo(slug, { countryCode: this.trustedRegion.countryFromHeaders(headers) });
  }
  @Get("channels/:handle") getChannel(@Param("handle") handle: string) { return this.seo.getChannel(handle); }
  @Get("playlists/:handle/:slug") getPlaylist(@Param("handle") handle: string, @Param("slug") slug: string) { return this.seo.getPlaylist(handle, slug); }
  @Get("sitemap/:kind")
  listSitemap(@Param("kind") kindRaw: string, @Query() query: unknown) {
    if (!sitemapKinds.has(kindRaw as SeoSitemapKind)) throw new BadRequestException("Unsupported SEO sitemap kind.");
    const parsed = sitemapQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid SEO sitemap pagination.");
    return this.seo.listSitemap(kindRaw as SeoSitemapKind, parsed.data.offset, parsed.data.limit);
  }
}
''')

# Web server forwards only authenticated internal edge country to API.
replace(
    "apps/web/src/lib/seo-content.ts",
    'import { cache } from "react";\n',
    'import { cache } from "react";\n',
)
replace(
    "apps/web/src/lib/seo-content.ts",
    "export const getSeoVideo = cache(async (slug: string): Promise<SeoVideoResponse | null> => {\n  return fetchSeo<SeoVideoResponse>(`/public/seo/videos/${encodeURIComponent(slug)}`);\n});",
    "export async function getSeoVideo(slug: string, requestHeaders: Record<string, string> = {}): Promise<SeoVideoResponse | null> {\n  return fetchSeo<SeoVideoResponse>(`/public/seo/videos/${encodeURIComponent(slug)}`, requestHeaders);\n}",
)
replace(
    "apps/web/src/lib/seo-content.ts",
    "async function fetchSeo<T>(path: string): Promise<T | null> {\n  const response = await fetch(`${apiBaseUrl}${path}`, { cache: \"no-store\" });",
    "async function fetchSeo<T>(path: string, requestHeaders: Record<string, string> = {}): Promise<T | null> {\n  const response = await fetch(`${apiBaseUrl}${path}`, { cache: \"no-store\", headers: requestHeaders });",
)
replace(
    "apps/web/src/app/(viewer)/watch/[slug]/page.tsx",
    'import { getSeoVideo } from "@/lib/seo-content";\n',
    'import { getSeoVideo } from "@/lib/seo-content";\nimport { trustedApiRegionHeaders } from "@/lib/trusted-region";\n',
)
replace(
    "apps/web/src/app/(viewer)/watch/[slug]/page.tsx",
    "  const { slug } = await params;\n  const video = await getSeoVideo(slug);",
    "  const { slug } = await params;\n  const regionHeaders = await trustedApiRegionHeaders();\n  const video = await getSeoVideo(slug, regionHeaders);",
    1,
)
replace(
    "apps/web/src/app/(viewer)/watch/[slug]/page.tsx",
    "  const { slug } = await params;\n  const [response, seoVideo] = await Promise.all([\n    fetch(`${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback`, {\n      cache: \"no-store\",\n    }),\n    getSeoVideo(slug),",
    "  const { slug } = await params;\n  const regionHeaders = await trustedApiRegionHeaders();\n  const [response, seoVideo] = await Promise.all([\n    fetch(`${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback`, {\n      cache: \"no-store\",\n      headers: regionHeaders,\n    }),\n    getSeoVideo(slug, regionHeaders),",
)

# Web metadata types and optional advanced controls.
replace(
    "apps/web/src/lib/quick-upload.ts",
    "  rightsNote?: string | null;\n",
    "  rightsNote?: string | null;\n  rightsExpiresAt?: string | null;\n",
)
replace(
    "apps/web/src/lib/quick-upload.ts",
    "  maturityLevel?: \"GENERAL\" | \"TEEN\" | \"MATURE\" | null;\n",
    "  maturityLevel?: \"GENERAL\" | \"TEEN\" | \"MATURE\" | null;\n  ageRestriction?: \"NONE\" | \"AGE_13_PLUS\" | \"AGE_18_PLUS\" | null;\n  allowedTerritories?: string[];\n  blockedTerritories?: string[];\n",
)
# Add draft fields.
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "  rightsNote: string;\n",
    "  rightsNote: string;\n  rightsExpiresAt: string;\n",
)
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "  maturityLevel: \"\" | \"GENERAL\" | \"TEEN\" | \"MATURE\";\n",
    "  maturityLevel: \"\" | \"GENERAL\" | \"TEEN\" | \"MATURE\";\n  ageRestriction: \"\" | \"NONE\" | \"AGE_13_PLUS\" | \"AGE_18_PLUS\";\n  allowedTerritories: string;\n  blockedTerritories: string;\n",
)
replace("apps/web/src/components/upload/video-metadata-fields.tsx", "  rightsNote: \"\",\n", "  rightsNote: \"\",\n  rightsExpiresAt: \"\",\n")
replace("apps/web/src/components/upload/video-metadata-fields.tsx", "  maturityLevel: \"\",\n", "  maturityLevel: \"\",\n  ageRestriction: \"\",\n  allowedTerritories: \"\",\n  blockedTerritories: \"\",\n")
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "    rightsNote: stringValue(metadata.rightsNote),\n",
    "    rightsNote: stringValue(metadata.rightsNote),\n    rightsExpiresAt: dateTimeLocalValue(metadata.rightsExpiresAt),\n",
)
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "    maturityLevel: stringValue(metadata.maturityLevel) as MetadataDraft[\"maturityLevel\"],\n",
    "    maturityLevel: stringValue(metadata.maturityLevel) as MetadataDraft[\"maturityLevel\"],\n    ageRestriction: stringValue(metadata.ageRestriction) as MetadataDraft[\"ageRestriction\"],\n    allowedTerritories: listValue(metadata.allowedTerritories),\n    blockedTerritories: listValue(metadata.blockedTerritories),\n",
)
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "    if (draft.rightsNote.trim()) result.rightsNote = draft.rightsNote.trim();\n    else if (includeEmpty) result.rightsNote = null;\n",
    "    if (draft.rightsNote.trim()) result.rightsNote = draft.rightsNote.trim();\n    else if (includeEmpty) result.rightsNote = null;\n    if (draft.rightsExpiresAt) result.rightsExpiresAt = new Date(draft.rightsExpiresAt).toISOString();\n    else if (includeEmpty) result.rightsExpiresAt = null;\n",
)
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "  if (draft.maturityLevel) result.maturityLevel = draft.maturityLevel;\n  else if (includeEmpty) result.maturityLevel = null;\n  if (draft.geoAvailabilityMode) result.geoAvailabilityMode = draft.geoAvailabilityMode;\n  else if (includeEmpty) result.geoAvailabilityMode = null;\n  const countries = splitList(draft.geoCountries).map((value) => value.toUpperCase());\n  if (countries.length || includeEmpty) result.geoCountries = countries;",
    "  if (draft.maturityLevel) result.maturityLevel = draft.maturityLevel;\n  else if (includeEmpty) result.maturityLevel = null;\n  if (draft.ageRestriction) result.ageRestriction = draft.ageRestriction;\n  else if (includeEmpty) result.ageRestriction = \"NONE\";\n  const allowedTerritories = splitList(draft.allowedTerritories).map((value) => value.toUpperCase());\n  const blockedTerritories = splitList(draft.blockedTerritories).map((value) => value.toUpperCase());\n  if (allowedTerritories.length || includeEmpty) result.allowedTerritories = allowedTerritories;\n  if (blockedTerritories.length || includeEmpty) result.blockedTerritories = blockedTerritories;",
)
# Insert rights expiry input after rights note.
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "          </label>\n        </>\n      ) : null}\n\n      <label className={fullWidthClassName}>\n        <span>Series / episode placeholder</span>",
    "          </label>\n          <label>\n            <span>Rights expiration</span>\n            <input disabled={disabled} type=\"datetime-local\" value={value.rightsExpiresAt} onChange={(event) => set(\"rightsExpiresAt\", event.target.value)} />\n            <small>Optional distribution-rights expiry. Channel owner only in Studio.</small>\n          </label>\n        </>\n      ) : null}\n\n      <label className={fullWidthClassName}>\n        <span>Series / episode placeholder</span>",
)
# Replace old geo controls block with age + allow/block controls.
start = Path("apps/web/src/components/upload/video-metadata-fields.tsx").read_text()
old = '''      <label>
        <span>Geographic availability</span>
        <select
          disabled={disabled}
          value={value.geoAvailabilityMode}
          onChange={(event) =>
            set("geoAvailabilityMode", event.target.value as MetadataDraft["geoAvailabilityMode"])
          }
        >
          <option value="">Not set / platform default</option>
          <option value="WORLDWIDE">Worldwide</option>
          <option value="INCLUDE_ONLY">Only selected countries</option>
          <option value="EXCLUDE">Everywhere except selected countries</option>
        </select>
      </label>

      <label className={fullWidthClassName}>
        <span>Country codes</span>
        <input
          disabled={disabled || value.geoAvailabilityMode === "WORLDWIDE"}
          value={value.geoCountries}
          placeholder="EG, US, GB"
          onChange={(event) => set("geoCountries", event.target.value)}
        />
        <small>
          This is a catalog policy hook; enforcement remains owned by AYIN availability policy.
        </small>
      </label>
'''
new = '''      <label>
        <span>Age restriction hook</span>
        <select disabled={disabled} value={value.ageRestriction} onChange={(event) => set("ageRestriction", event.target.value as MetadataDraft["ageRestriction"])}>
          <option value="">None (default)</option>
          <option value="AGE_13_PLUS">13+ hook</option>
          <option value="AGE_18_PLUS">18+ hook</option>
        </select>
        <small>This is a product-policy hook, not a claim of regulatory compliance or age verification.</small>
      </label>

      <label className={fullWidthClassName}>
        <span>Allowed territories</span>
        <input disabled={disabled} value={value.allowedTerritories} placeholder="US, EG, GB" onChange={(event) => set("allowedTerritories", event.target.value)} />
        <small>ISO two-letter country codes. Leave allowed and blocked lists empty for worldwide availability.</small>
      </label>

      <label className={fullWidthClassName}>
        <span>Blocked territories</span>
        <input disabled={disabled} value={value.blockedTerritories} placeholder="DE, FR" onChange={(event) => set("blockedTerritories", event.target.value)} />
        <small>Server-side playback, search, discovery, SEO and Creator TV all enforce these restrictions.</small>
      </label>
'''
if old not in start:
    raise SystemExit("old web geo block not found")
Path("apps/web/src/components/upload/video-metadata-fields.tsx").write_text(start.replace(old, new, 1))
# Helpers for API hydration.
replace(
    "apps/web/src/components/upload/video-metadata-fields.tsx",
    "function stringValue(value: unknown): string {",
    "function listValue(value: unknown): string {\n  return Array.isArray(value) ? value.filter((item): item is string => typeof item === \"string\").join(\", \") : \"\";\n}\n\nfunction dateTimeLocalValue(value: unknown): string {\n  if (typeof value !== \"string\" || !value) return \"\";\n  const date = new Date(value);\n  if (!Number.isFinite(date.getTime())) return \"\";\n  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);\n  return local.toISOString().slice(0, 16);\n}\n\nfunction stringValue(value: unknown): string {",
)

# Update watch unit harness and add private/unlisted boundary tests.
replace(
    "apps/api/src/watch/watch.service.test.ts",
    "  const service = new WatchService(database as never, settings as never, featureFlags as never);",
    "  const policy = { decide: vi.fn().mockResolvedValue({ allowed: true, maturityLevel: null, ageRestriction: \"NONE\" }), filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)) };\n  const service = new WatchService(database as never, settings as never, featureFlags as never, policy as never);",
)
replace(
    "apps/api/src/watch/watch.service.test.ts",
    "  it(\"falls through to MP4 when HLS is enabled but no complete READY generation exists\", async () => {",
    "  it(\"keeps PRIVATE as a hard boundary before any policy/admin override can expose it\", async () => {\n    const { service } = harness({ hlsEnabled: false });\n    (service as any).database.client.video.findUnique.mockResolvedValue({ ...video, visibility: \"PRIVATE\" });\n    await expect(service.getPublicPlayback(video.slug, \"US\")).rejects.toMatchObject({ code: \"VIDEO_NOT_FOUND\", statusCode: 404 });\n  });\n\n  it(\"allows direct UNLISTED playback when policy allows it\", async () => {\n    const { service } = harness({ hlsEnabled: false });\n    (service as any).database.client.video.findUnique.mockResolvedValue({ ...video, visibility: \"UNLISTED\" });\n    await expect(service.getPublicPlayback(video.slug, \"US\")).resolves.toHaveProperty(\"video.id\", video.id);\n  });\n\n  it(\"falls through to MP4 when HLS is enabled but no complete READY generation exists\", async () => {",
)

# Search unit constructor compatibility.
search_test = Path("apps/api/src/search/search.service.test.ts")
if search_test.exists():
    text = search_test.read_text()
    text = text.replace("new SearchService(database as never)", "new SearchService(database as never, { filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)) } as never)")
    search_test.write_text(text)

# Country/legacy validation coverage.
validation_test = Path("apps/api/src/creator/video-metadata.validation.test.ts")
if validation_test.exists():
    text = validation_test.read_text()
    marker = "\n});\n"
    addition = r'''
  it("accepts standard ISO territories and rejects invented codes or overlaps", () => {
    expect(videoMetadataSchema.safeParse({ allowedTerritories: ["us", "EG"], blockedTerritories: ["GB"] }).success).toBe(true);
    expect(videoMetadataSchema.safeParse({ allowedTerritories: ["ZZ"] }).success).toBe(false);
    expect(videoMetadataSchema.safeParse({ allowedTerritories: ["US"], blockedTerritories: ["US"] }).success).toBe(false);
  });

  it("keeps legacy geo input compatible but rejects mixing legacy and authoritative lists", () => {
    expect(videoMetadataSchema.safeParse({ geoAvailabilityMode: "INCLUDE_ONLY", geoCountries: ["US"] }).success).toBe(true);
    expect(videoMetadataSchema.safeParse({ geoAvailabilityMode: "EXCLUDE", geoCountries: ["US"], blockedTerritories: ["GB"] }).success).toBe(false);
  });
'''
    pos = text.rfind(marker)
    if pos < 0: raise SystemExit("validation test closing marker not found")
    validation_test.write_text(text[:pos] + addition + text[pos:])

# Creator TV eligibility focused unit test using the private loader through public schedule.
write("apps/api/src/creator/creator-tv-policy.test.ts", r'''import { describe, expect, it, vi } from "vitest";

import { CreatorTvService } from "./creator-tv.service.js";

describe("Creator TV policy eligibility", () => {
  it("goes off air when the only base-eligible video is unavailable in the viewer region", async () => {
    const video = {
      id: "11111111-1111-4111-8111-111111111111", slug: "regional", title: "Regional", description: null,
      durationMs: 60_000, publishedAt: new Date("2026-09-01T00:00:00.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z"),
      mediaAssets: [{ kind: "SOURCE_VIDEO", r2ObjectKey: "source.mp4", mimeType: "video/mp4", durationMs: 60_000 }], tvPreferences: [],
    };
    const database = { client: {
      creatorTvChannel: { findUnique: vi.fn().mockResolvedValue({ id: "tv", channelId: "channel", slug: "tv", name: "TV", status: "ACTIVE", createdAt: new Date("2026-09-01T00:00:00.000Z"), channel: { settings: { autoAddPublishedToTv: true, tvAutoScheduleEnabled: true } } }) },
      video: { findMany: vi.fn().mockResolvedValue([video]) },
      tvScheduleItem: { findMany: vi.fn().mockResolvedValue([]) },
      videoCreatorMetadata: { findMany: vi.fn().mockResolvedValue([]) },
    } };
    const settings = { get: vi.fn(async (key: string) => ({ autoAddPublishedUploadsToCreatorTv: true, creatorTvFallbackProgramDurationMs: 60_000, creatorTvGuideWindowMinutes: 60, creatorTvRotationMode: "CHRONOLOGICAL" } as Record<string, unknown>)[key]) };
    const channels = { getPublicChannel: vi.fn().mockResolvedValue({ canonicalHandle: "creator", redirectedFrom: null, channel: { id: "channel", handle: "creator", name: "Creator" }, appearance: {}, creatorTv: { id: "tv" } }) };
    const adHook = { getBreaks: vi.fn().mockResolvedValue([]) };
    const policy = { filterAvailableVideoIds: vi.fn().mockResolvedValue(new Set<string>()) };
    const service = new CreatorTvService(database as never, settings as never, channels as never, adHook as never, policy as never);
    const response = await service.getPublicTv("creator", new Date("2026-09-13T00:00:00.000Z"), { countryCode: "DE" });
    expect(response.tv).toMatchObject({ state: "OFF_AIR", offAirReason: "NO_ELIGIBLE_VIDEOS" });
    expect(policy.filterAvailableVideoIds).toHaveBeenCalledWith([video.id], { countryCode: "DE" });
  });
});
''')
