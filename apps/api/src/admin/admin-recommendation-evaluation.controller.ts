import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { RecommendationEvaluationService } from "../recommendations/recommendation-evaluation.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, RequireAdminRoles } from "./admin.guard.js";

const fixtureQuerySchema = z.object({
  baselineVersionId: z.string().trim().min(1).max(120).default("baseline"),
  candidateVersionId: z.string().trim().min(1).max(120).default("balanced"),
});

const versionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const exposuresQuerySchema = z.object({
  versionId: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const exportQuerySchema = z.object({
  versionIds: z.string().trim().min(1).max(1_000),
  days: z.coerce.number().int().min(1).max(90).default(14),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
});

@Controller("admin/recommendation-evaluation")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminRecommendationEvaluationController {
  constructor(
    @Inject(RecommendationEvaluationService)
    private readonly evaluation: RecommendationEvaluationService,
  ) {}

  @Get("fixed-fixture")
  fixedFixture(@Query() query: unknown) {
    const parsed = fixtureQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidEvaluationRequest();
    return this.evaluation.evaluateFixedFixture(
      parsed.data.baselineVersionId,
      parsed.data.candidateVersionId,
    );
  }

  @Get("versions")
  versions(@Query() query: unknown) {
    const parsed = versionsQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidEvaluationRequest();
    return this.evaluation.listVersions(parsed.data.days);
  }

  @Get("exposures")
  exposures(@Query() query: unknown) {
    const parsed = exposuresQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidEvaluationRequest();
    return this.evaluation.debugExposures(parsed.data.versionId, parsed.data.limit);
  }

  @Get("export")
  exportDataset(@Query() query: unknown) {
    const parsed = exportQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidEvaluationRequest();
    return this.evaluation.exportObservedDataset(
      parsed.data.versionIds.split(","),
      parsed.data.days,
      parsed.data.limit,
    );
  }
}

function invalidEvaluationRequest() {
  return adminBadRequest(
    "INVALID_RECOMMENDATION_EVALUATION_REQUEST",
    "Check the recommendation version, date range and limit parameters.",
  );
}
