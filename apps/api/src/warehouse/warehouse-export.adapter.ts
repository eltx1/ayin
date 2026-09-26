import type {
  WarehouseDatasetName,
  WarehouseDatasetRecordMap,
} from "./warehouse-export.schemas.js";

export const WAREHOUSE_EXPORT_ADAPTER = Symbol("WAREHOUSE_EXPORT_ADAPTER");

export type WarehouseExportPattern =
  | "OBJECT_BATCH"
  | "BATCH_FILE"
  | "DATABASE_EXPORT"
  | "WAREHOUSE_API";

export interface WarehouseExportBatch<TDataset extends WarehouseDatasetName = WarehouseDatasetName> {
  batchId: string;
  dataset: TDataset;
  schemaVersion: 1;
  partitionDate: string;
  cursor: {
    fromAt: string | null;
    fromId: string | null;
    throughAt: string;
    throughId: string;
  };
  records: Array<WarehouseDatasetRecordMap[TDataset]>;
}

export interface WarehouseExportReceipt {
  batchId: string;
  accepted: true;
  providerReceipt: string | null;
}

export interface WarehouseExportAdapter {
  readonly kind: string;
  readonly configured: boolean;
  readonly patterns: readonly WarehouseExportPattern[];
  writeBatch<TDataset extends WarehouseDatasetName>(
    batch: WarehouseExportBatch<TDataset>,
  ): Promise<WarehouseExportReceipt>;
}

export class DisabledWarehouseExportAdapter implements WarehouseExportAdapter {
  readonly kind = "DISABLED";
  readonly configured = false;
  readonly patterns = [] as const;

  async writeBatch<TDataset extends WarehouseDatasetName>(
    batch: WarehouseExportBatch<TDataset>,
  ): Promise<WarehouseExportReceipt> {
    void batch;
    throw new Error("WAREHOUSE_EXPORT_NOT_CONFIGURED");
  }
}
