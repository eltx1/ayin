import { Injectable } from "@nestjs/common";

import {
  revenueReportImportSchema,
  revenueReportRowSchema,
  type RevenueReportRowInput,
} from "./revenue-reconciliation.schemas.js";

export const REVENUE_REPORTING_ADAPTER = Symbol("REVENUE_REPORTING_ADAPTER");

export interface NormalizedRevenueReport {
  source: string;
  sourceReportId: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  state: "ESTIMATED" | "FINAL";
  format: "STRUCTURED" | "CSV";
  rows: RevenueReportRowInput[];
}

export interface RevenueReportingAdapter {
  readonly kind: string;
  readonly automaticSyncConfigured: boolean;
  capabilities(): {
    adapter: string;
    providerNeutral: true;
    automaticProviderSyncConfigured: boolean;
    supportedImportFormats: Array<"STRUCTURED" | "CSV">;
    maxRows: number;
    requiredEnvelopeFields: string[];
    csvColumns: { required: string[]; optional: string[] };
  };
  normalize(input: unknown): NormalizedRevenueReport;
}

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) records.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTED_FIELD");
  row.push(field);
  if (row.some((value) => value.trim() !== "")) records.push(row);
  return records;
}

function emptyToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseRevenueReportCsv(csv: string): RevenueReportRowInput[] {
  const records = parseCsvRecords(csv);
  if (records.length < 2) throw new Error("CSV_REQUIRES_HEADER_AND_DATA");

  const headers = records[0]!.map(normalizedHeader);
  if (new Set(headers).size !== headers.length) throw new Error("CSV_DUPLICATE_HEADER");

  const required = ["externalrowid", "grossamount"];
  for (const name of required) {
    if (!headers.includes(name)) throw new Error(`CSV_MISSING_COLUMN_${name}`);
  }

  const rows = records.slice(1).map((record, rowIndex) => {
    if (record.length > headers.length) throw new Error(`CSV_ROW_${rowIndex + 2}_TOO_MANY_COLUMNS`);
    const values = new Map<string, string>();
    headers.forEach((header, index) => values.set(header, record[index] ?? ""));
    return revenueReportRowSchema.parse({
      externalRowId: emptyToUndefined(values.get("externalrowid")),
      grossAmount: emptyToUndefined(values.get("grossamount")),
      channelId: emptyToUndefined(values.get("channelid")),
      channelHandle: emptyToUndefined(values.get("channelhandle")),
      videoId: emptyToUndefined(values.get("videoid")),
      videoSlug: emptyToUndefined(values.get("videoslug")),
      contentId: emptyToUndefined(values.get("contentid")),
      adSource: emptyToUndefined(values.get("adsource")),
      memo: emptyToUndefined(values.get("memo")),
    });
  });

  if (rows.length > 5000) throw new Error("CSV_TOO_MANY_ROWS");
  return rows;
}

@Injectable()
export class ManualRevenueReportingAdapter implements RevenueReportingAdapter {
  readonly kind = "MANUAL_VALIDATED_IMPORT";
  readonly automaticSyncConfigured = false;

  capabilities() {
    return {
      adapter: this.kind,
      providerNeutral: true as const,
      automaticProviderSyncConfigured: this.automaticSyncConfigured,
      supportedImportFormats: ["STRUCTURED", "CSV"] as Array<"STRUCTURED" | "CSV">,
      maxRows: 5000,
      requiredEnvelopeFields: [
        "source",
        "sourceReportId",
        "periodStart",
        "periodEnd",
        "currency",
        "state",
        "format",
      ],
      csvColumns: {
        required: ["externalRowId", "grossAmount"],
        optional: [
          "channelId",
          "channelHandle",
          "videoId",
          "videoSlug",
          "contentId",
          "adSource",
          "memo",
        ],
      },
    };
  }

  normalize(input: unknown): NormalizedRevenueReport {
    const parsed = revenueReportImportSchema.parse(input);
    const rows = parsed.format === "CSV" ? parseRevenueReportCsv(parsed.csv!) : (parsed.rows ?? []);
    if (rows.length === 0) throw new Error("REVENUE_REPORT_EMPTY");
    return {
      source: parsed.source,
      sourceReportId: parsed.sourceReportId,
      periodStart: new Date(parsed.periodStart),
      periodEnd: new Date(parsed.periodEnd),
      currency: parsed.currency,
      state: parsed.state,
      format: parsed.format,
      rows,
    };
  }
}
