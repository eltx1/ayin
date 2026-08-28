import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { DatabaseService } from "../database/database.service.js";

export const featureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
  description: z.string().trim().max(500).optional(),
});

export type FeatureFlagUpdate = z.infer<typeof featureFlagUpdateSchema>;

@Injectable()
export class FeatureFlagService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async isEnabled(key: string): Promise<boolean> {
    const resolved = await this.resolveEnabled([key]);
    return resolved[key] ?? false;
  }

  async resolveEnabled(keys: readonly string[]): Promise<Record<string, boolean>> {
    if (keys.length === 0) {
      return {};
    }

    const flags = await this.database.client.featureFlag.findMany({
      where: { key: { in: [...keys] } },
      select: { enabled: true, key: true, rolloutPercentage: true },
    });
    const stored = new Map(
      flags.map((flag) => [flag.key, flag.enabled && flag.rolloutPercentage > 0] as const),
    );

    return Object.fromEntries(keys.map((key) => [key, stored.get(key) ?? false]));
  }

  async list() {
    return this.database.client.featureFlag.findMany({ orderBy: { key: "asc" } });
  }

  async updateInTransaction(tx: Prisma.TransactionClient, key: string, input: unknown) {
    if (!/^[a-z][a-z0-9._-]{1,119}$/.test(key)) {
      throw new Error("Feature flag key is invalid.");
    }
    const value = featureFlagUpdateSchema.parse(input);
    const data = {
      enabled: value.enabled,
      rolloutPercentage: value.rolloutPercentage,
      ...(value.description !== undefined ? { description: value.description } : {}),
    };
    return tx.featureFlag.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
  }
}
