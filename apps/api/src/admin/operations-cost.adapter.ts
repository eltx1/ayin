import { Inject, Injectable } from "@nestjs/common";

import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

export const OPERATIONS_COST_ADAPTER = Symbol("OPERATIONS_COST_ADAPTER");

export type OperationsCostMode = "UNCONFIGURED" | "MANUAL_ESTIMATE" | "MANUAL_ACTUAL";
export type OperationsCostCategory =
  | "compute"
  | "database"
  | "objectStorage"
  | "mediaDelivery"
  | "liveFast"
  | "externalAiSearch"
  | "monitoring";

export interface OperationsCostCategoryValue {
  category: OperationsCostCategory;
  monthlyMicros: bigint;
  configured: boolean;
}

export interface OperationsCostSnapshot {
  provider: string;
  mode: OperationsCostMode;
  currency: string;
  categories: OperationsCostCategoryValue[];
  totalMonthlyMicros: bigint;
  complete: boolean;
  mediaProcessingComputeHourMicros: bigint | null;
  mediaProcessingRateConfigured: boolean;
}

export interface OperationsCostAdapter {
  readonly provider: string;
  readMonthlyCosts(referenceAt: Date): Promise<OperationsCostSnapshot>;
}

const categorySettings = [
  ["compute", "operationsComputeMonthlyMicros"],
  ["database", "operationsDatabaseMonthlyMicros"],
  ["objectStorage", "operationsObjectStorageMonthlyMicros"],
  ["mediaDelivery", "operationsMediaDeliveryMonthlyMicros"],
  ["liveFast", "operationsLiveFastMonthlyMicros"],
  ["externalAiSearch", "operationsExternalAiSearchMonthlyMicros"],
  ["monitoring", "operationsMonitoringMonthlyMicros"],
] as const;

const costSettingKeys = [
  "operationsCostModelMode",
  "operationsCostCurrency",
  ...categorySettings.map(([, key]) => key),
  "operationsMediaProcessingComputeHourMicros",
] as const;

@Injectable()
export class ManualOperationsCostAdapter implements OperationsCostAdapter {
  readonly provider = "MANUAL_SETTINGS";

  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async readMonthlyCosts(referenceAt: Date): Promise<OperationsCostSnapshot> {
    void referenceAt;
    const resolved = await this.settings.getManyResolved(costSettingKeys);
    const mode = resolved.get("operationsCostModelMode")?.value as OperationsCostMode;
    const currency = String(resolved.get("operationsCostCurrency")?.value ?? "USD");

    const categories: OperationsCostCategoryValue[] = categorySettings.map(([category, key]) => {
      const item = resolved.get(key);
      const value = Number(item?.value ?? 0);
      return {
        category,
        monthlyMicros: BigInt(Number.isSafeInteger(value) && value >= 0 ? value : 0),
        configured: item?.source === "stored",
      };
    });
    const processingRate = resolved.get("operationsMediaProcessingComputeHourMicros");
    const rateValue = Number(processingRate?.value ?? 0);
    const processingRateConfigured = processingRate?.source === "stored";

    return {
      provider: this.provider,
      mode,
      currency,
      categories,
      totalMonthlyMicros: categories.reduce((total, item) => total + item.monthlyMicros, 0n),
      complete:
        mode !== "UNCONFIGURED" &&
        resolved.get("operationsCostModelMode")?.source === "stored" &&
        resolved.get("operationsCostCurrency")?.source === "stored" &&
        categories.every((item) => item.configured),
      mediaProcessingComputeHourMicros: processingRateConfigured
        ? BigInt(Number.isSafeInteger(rateValue) && rateValue >= 0 ? rateValue : 0)
        : null,
      mediaProcessingRateConfigured,
    };
  }
}
