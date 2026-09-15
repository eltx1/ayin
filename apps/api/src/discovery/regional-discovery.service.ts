import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

export const REGIONAL_DISCOVERY_MIN_COHORT = 50;
const REGIONAL_DISCOVERY_WEIGHT = 0.8;

export type RegionalDiscoverySignal =
  "POPULAR_CONTENT" | "CATALOG" | "CREATOR_TV" | "CATEGORY_AFFINITY";

export interface RegionalRankableItem {
  id: string;
  type: string;
}

interface RegionalPage<T extends RegionalRankableItem> {
  items: T[];
  [key: string]: unknown;
}

interface RegionalRow<T extends RegionalRankableItem> {
  key: string;
  source: string;
  items: T[];
  [key: string]: unknown;
}

@Injectable()
export class RegionalDiscoveryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async rankItems<T extends RegionalRankableItem>(
    regionCode: string | undefined,
    signal: Exclude<RegionalDiscoverySignal, "CATEGORY_AFFINITY">,
    items: T[],
  ): Promise<T[]> {
    const region = normalizeRegionCode(regionCode);
    if (!region || items.length < 2) return items;

    const keyed = items.flatMap((item, index) => {
      const entityKey = entityKeyFor(signal, item);
      return entityKey ? [{ item, index, entityKey }] : [];
    });
    if (!keyed.length) return items;

    const aggregates = await this.database.client.regionalDiscoveryAggregate.findMany({
      where: {
        regionCode: region,
        signal,
        cohortSize: { gte: REGIONAL_DISCOVERY_MIN_COHORT },
        entityKey: { in: keyed.map((entry) => entry.entityKey) },
      },
      select: { entityKey: true, score: true },
    });
    if (!aggregates.length) return items;

    const scores = new Map(aggregates.map((aggregate) => [aggregate.entityKey, aggregate.score]));
    const finiteScores = aggregates.map((aggregate) => aggregate.score).filter(Number.isFinite);
    if (!finiteScores.length) return items;
    const min = Math.min(...finiteScores);
    const max = Math.max(...finiteScores);
    const span = max - min;
    const total = items.length;

    return items
      .map((item, index) => {
        const entityKey = entityKeyFor(signal, item);
        const regionalScore = entityKey ? scores.get(entityKey) : undefined;
        const normalizedRegional =
          regionalScore === undefined || !Number.isFinite(regionalScore)
            ? 0
            : span > 0
              ? (regionalScore - min) / span
              : 1;
        const globalRankScore = (total - index) / total;
        return {
          item,
          index,
          score: globalRankScore + normalizedRegional * REGIONAL_DISCOVERY_WEIGHT,
        };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.item);
  }

  async rankPage<T extends RegionalRankableItem>(
    regionCode: string | undefined,
    personalizationAllowed: boolean,
    source: string,
    page: RegionalPage<T>,
  ): Promise<RegionalPage<T>> {
    if (!personalizationAllowed) return page;
    const signal = signalForSource(source);
    if (!signal) return page;
    return {
      ...page,
      items: await this.rankItems(regionCode, signal, page.items),
    };
  }

  async rankAndTargetRows<T extends RegionalRankableItem>(
    regionCode: string | undefined,
    personalizationAllowed: boolean,
    rows: RegionalRow<T>[],
  ): Promise<RegionalRow<T>[]> {
    const region = personalizationAllowed ? normalizeRegionCode(regionCode) : undefined;
    const visible = await this.filterMerchandisingRows(region, rows);
    if (!personalizationAllowed || !region) return visible;

    return Promise.all(
      visible.map(async (row) => ({
        ...row,
        items: await this.rankItemsForSource(region, row.source, row.items),
      })),
    );
  }

  async isMerchandisingRowAllowed(
    rowKey: string,
    regionCode: string | undefined,
    personalizationAllowed: boolean,
  ): Promise<boolean> {
    const region = personalizationAllowed ? normalizeRegionCode(regionCode) : undefined;
    const row = await this.database.client.homeRowConfig.findUnique({
      where: { key: rowKey },
      select: { regionTargets: { select: { regionCode: true } } },
    });
    if (!row || row.regionTargets.length === 0) return true;
    return Boolean(region && row.regionTargets.some((target) => target.regionCode === region));
  }

  async categoryAffinity(
    regionCode: string | undefined,
    categoryKeys: string[],
  ): Promise<Map<string, number>> {
    const region = normalizeRegionCode(regionCode);
    const categories = [...new Set(categoryKeys.map(normalizeCategoryKey).filter(Boolean))];
    if (!region || !categories.length) return new Map();

    const aggregates = await this.database.client.regionalDiscoveryAggregate.findMany({
      where: {
        regionCode: region,
        signal: "CATEGORY_AFFINITY",
        cohortSize: { gte: REGIONAL_DISCOVERY_MIN_COHORT },
        entityKey: { in: categories.map((category) => `category:${category}`) },
      },
      select: { entityKey: true, score: true },
    });

    return new Map(
      aggregates
        .filter((aggregate) => Number.isFinite(aggregate.score))
        .map((aggregate) => [aggregate.entityKey.slice("category:".length), aggregate.score]),
    );
  }

  private async filterMerchandisingRows<T extends RegionalRankableItem>(
    regionCode: string | undefined,
    rows: RegionalRow<T>[],
  ): Promise<RegionalRow<T>[]> {
    if (!rows.length) return rows;
    const configs = await this.database.client.homeRowConfig.findMany({
      where: { key: { in: rows.map((row) => row.key) } },
      select: { key: true, regionTargets: { select: { regionCode: true } } },
    });
    const targets = new Map(
      configs.map((config) => [
        config.key,
        new Set(config.regionTargets.map((target) => target.regionCode)),
      ]),
    );
    return rows.filter((row) => {
      const rowTargets = targets.get(row.key);
      if (!rowTargets || rowTargets.size === 0) return true;
      return Boolean(regionCode && rowTargets.has(regionCode));
    });
  }

  private rankItemsForSource<T extends RegionalRankableItem>(
    regionCode: string,
    source: string,
    items: T[],
  ): Promise<T[]> {
    const signal = signalForSource(source);
    return signal ? this.rankItems(regionCode, signal, items) : Promise.resolve(items);
  }
}

function signalForSource(
  source: string,
): Exclude<RegionalDiscoverySignal, "CATEGORY_AFFINITY"> | null {
  if (["TRENDING_WORLDWIDE", "POPULAR_NOW", "POPULAR_REGION"].includes(source)) {
    return "POPULAR_CONTENT";
  }
  if (["MOVIES", "SERIES"].includes(source)) return "CATALOG";
  if (source === "CREATOR_TV") return "CREATOR_TV";
  return null;
}

function entityKeyFor(
  signal: Exclude<RegionalDiscoverySignal, "CATEGORY_AFFINITY">,
  item: RegionalRankableItem,
): string | null {
  if (signal === "POPULAR_CONTENT") {
    return item.type === "VIDEO" ? `video:${item.id}` : null;
  }
  if (signal === "CREATOR_TV") {
    return item.type === "CREATOR_TV" ? `creator-tv:${item.id}` : null;
  }
  if (signal === "CATALOG") {
    if (item.type === "VIDEO") return `video:${item.id}`;
    if (item.type === "SERIES") return `series:${item.id}`;
  }
  return null;
}

function normalizeRegionCode(regionCode?: string): string | undefined {
  if (!regionCode) return undefined;
  const normalized = regionCode.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeCategoryKey(categoryKey: string): string {
  return categoryKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
