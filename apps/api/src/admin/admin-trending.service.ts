import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  defaultTrendingConfig,
  parseTrendingConfig,
  TRENDING_SETTING_KEY,
  TRENDING_SETTING_NAMESPACE,
  trendingConfigSchema,
  type TrendingConfig,
} from "../platform-config/trending-settings.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";

@Injectable()
export class AdminTrendingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async getConfig(): Promise<TrendingConfig> {
    const setting = await this.database.client.platformSetting.findUnique({
      where: {
        namespace_key: {
          namespace: TRENDING_SETTING_NAMESPACE,
          key: TRENDING_SETTING_KEY,
        },
      },
      select: { value: true },
    });
    return setting ? parseTrendingConfig(setting.value) : defaultTrendingConfig;
  }

  async updateConfig(
    actorAccountId: string,
    configInput: TrendingConfig,
    reason: string,
  ): Promise<TrendingConfig> {
    const config = trendingConfigSchema.parse(configInput);
    const value = config as unknown as Prisma.InputJsonValue;

    return this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: {
          namespace_key: {
            namespace: TRENDING_SETTING_NAMESPACE,
            key: TRENDING_SETTING_KEY,
          },
        },
        update: { value, valueType: "JSON", schemaVersion: 1 },
        create: {
          namespace: TRENDING_SETTING_NAMESPACE,
          key: TRENDING_SETTING_KEY,
          valueType: "JSON",
          value,
          schemaVersion: 1,
          description:
            "Bounded weights, cohort thresholds and anti-manipulation controls for AYIN Trending.",
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "TRENDING_ENGINE_CONFIG_UPDATED",
        entityType: "PlatformSetting",
        entityId: `${TRENDING_SETTING_NAMESPACE}:${TRENDING_SETTING_KEY}`,
        reason,
        metadata: {
          windowHours: config.windowHours,
          recentHours: config.recentHours,
          minAudienceGlobal: config.minAudienceGlobal,
          minAudienceRegional: config.minAudienceRegional,
          maxVelocityMultiplier: config.maxVelocityMultiplier,
        },
      });

      return config;
    });
  }
}
