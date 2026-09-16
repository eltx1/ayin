import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { recommendationEvaluationFixture } from "./recommendation-evaluation.fixture.js";
import {
  assessRecommendationRelease,
  evaluateRecommendationVersion,
} from "./recommendation-evaluator.js";

const DAY_MS = 86_400_000;

type AttributedEventRow = {
  exposureId: string;
  videoId: string | null;
  eventName: string;
  durationDeltaMs: number | null;
};

@Injectable()
export class RecommendationEvaluationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  evaluateFixedFixture(baselineVersionId = "baseline", candidateVersionId = "balanced") {
    const baseline = evaluateRecommendationVersion(
      recommendationEvaluationFixture,
      baselineVersionId,
      4,
    );
    const candidate = evaluateRecommendationVersion(
      recommendationEvaluationFixture,
      candidateVersionId,
      4,
    );
    return {
      fixtureId: recommendationEvaluationFixture.fixtureId,
      baseline,
      candidate,
      releaseAssessment: assessRecommendationRelease(baseline, candidate),
    };
  }

  async listVersions(days = 30) {
    const from = new Date(Date.now() - clamp(days, 1, 365) * DAY_MS);
    const groups = await this.database.client.recommendationExposure.groupBy({
      by: ["versionId", "algorithmId", "surface", "mode"],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      orderBy: { _count: { versionId: "desc" } },
    });
    return groups.map((group) => ({
      versionId: group.versionId,
      algorithmId: group.algorithmId,
      surface: group.surface,
      mode: group.mode,
      exposures: group._count._all,
      firstSeenAt: group._min.createdAt,
      lastSeenAt: group._max.createdAt,
    }));
  }

  async debugExposures(versionId: string, limit = 20) {
    const exposures = await this.database.client.recommendationExposure.findMany({
      where: { versionId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: clamp(limit, 1, 100),
      select: {
        id: true,
        versionId: true,
        algorithmId: true,
        surface: true,
        mode: true,
        rankingSize: true,
        itemIds: true,
        components: true,
        createdAt: true,
      },
    });
    return {
      versionId,
      privacyNote:
        "Exposure debug records contain ranking outputs and score contributions only; no profile, session, account, IP or precise-location identifiers are stored.",
      exposures,
    };
  }

  async exportObservedDataset(versionIds: string[], days = 14, limit = 500) {
    const versions = [...new Set(versionIds.map((value) => value.trim()).filter(Boolean))].slice(0, 8);
    if (!versions.length) return { versions: [], telemetryCoverage: 0, exposures: [] };
    const from = new Date(Date.now() - clamp(days, 1, 90) * DAY_MS);
    const exposures = await this.database.client.recommendationExposure.findMany({
      where: { versionId: { in: versions }, createdAt: { gte: from } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: clamp(limit, 1, 2_000),
      select: {
        id: true,
        versionId: true,
        algorithmId: true,
        surface: true,
        mode: true,
        itemIds: true,
        components: true,
        createdAt: true,
      },
    });
    if (!exposures.length) return { versions, telemetryCoverage: 0, exposures: [] };

    const ids = exposures.map((exposure) => exposure.id);
    const events = await this.database.client.$queryRaw<AttributedEventRow[]>(Prisma.sql`
      SELECT
        metadata->>'recommendationExposureId' AS "exposureId",
        "videoId"::text AS "videoId",
        "eventName",
        "durationDeltaMs"
      FROM "AnalyticsEvent"
      WHERE "occurredAt" >= ${from}
        AND metadata->>'recommendationExposureId' IN (${Prisma.join(ids)})
        AND "eventName" IN (
          'RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICK',
          'VIDEO_START', 'VIDEO_PROGRESS', 'VIDEO_COMPLETE'
        )
    `);

    const byExposure = new Map<string, AttributedEventRow[]>();
    for (const event of events) {
      const rows = byExposure.get(event.exposureId) ?? [];
      rows.push(event);
      byExposure.set(event.exposureId, rows);
    }

    let attributed = 0;
    const exported = exposures.map((exposure) => {
      const exposureEvents = byExposure.get(exposure.id) ?? [];
      if (exposureEvents.length) attributed += 1;
      const outcomes = new Map<
        string,
        { videoId: string; impression: boolean; clicked: boolean; watchTimeMs: number; completed: boolean }
      >();
      for (const event of exposureEvents) {
        if (!event.videoId) continue;
        const outcome = outcomes.get(event.videoId) ?? {
          videoId: event.videoId,
          impression: false,
          clicked: false,
          watchTimeMs: 0,
          completed: false,
        };
        if (event.eventName === "RECOMMENDATION_IMPRESSION") outcome.impression = true;
        if (event.eventName === "RECOMMENDATION_CLICK") outcome.clicked = true;
        if (event.eventName === "VIDEO_PROGRESS") {
          outcome.watchTimeMs += Math.max(0, Math.min(event.durationDeltaMs ?? 0, 60_000));
        }
        if (event.eventName === "VIDEO_COMPLETE") outcome.completed = true;
        outcomes.set(event.videoId, outcome);
      }
      return {
        exposureId: exposure.id,
        versionId: exposure.versionId,
        algorithmId: exposure.algorithmId,
        surface: exposure.surface,
        mode: exposure.mode,
        itemIds: exposure.itemIds,
        components: exposure.components,
        createdAt: exposure.createdAt,
        outcomes: [...outcomes.values()],
      };
    });

    return {
      versions,
      from,
      telemetryCoverage: exposures.length > 0 ? attributed / exposures.length : 0,
      attributionContract: {
        metadataKeys: ["recommendationExposureId", "recommendationVersion"],
        note: "Recall cannot be inferred from unshown production items without a labelled candidate set; use fixed offline fixtures for recall comparisons.",
      },
      exposures: exported,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
