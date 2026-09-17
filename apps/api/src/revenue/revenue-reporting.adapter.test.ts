import { describe, expect, it } from "vitest";

import {
  ManualRevenueReportingAdapter,
  parseRevenueReportCsv,
} from "./revenue-reporting.adapter.js";

describe("provider-neutral revenue reporting adapter", () => {
  it("normalizes structured reports without claiming provider API sync", () => {
    const adapter = new ManualRevenueReportingAdapter();
    const report = adapter.normalize({
      source: "independent-ad-platform",
      sourceReportId: "report-2026-08-estimated",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
      currency: "usd",
      state: "ESTIMATED",
      format: "STRUCTURED",
      rows: [
        {
          externalRowId: "row-1",
          grossAmount: "12.345678",
          channelHandle: "@creator-one",
          contentId: "external-content-9",
        },
      ],
    });

    expect(report.currency).toBe("USD");
    expect(report.rows[0]?.channelHandle).toBe("creator-one");
    expect(adapter.capabilities().automaticProviderSyncConfigured).toBe(false);
    expect(adapter.capabilities().providerNeutral).toBe(true);
  });

  it("parses validated CSV including quoted commas and escaped quotes", () => {
    const rows = parseRevenueReportCsv(
      [
        "external_row_id,gross_amount,channel_handle,memo",
        'row-1,12.345678,creator-one,"Revenue, revised ""once"""',
      ].join("\r\n"),
    );
    expect(rows).toEqual([
      {
        externalRowId: "row-1",
        grossAmount: "12.345678",
        channelHandle: "creator-one",
        memo: 'Revenue, revised "once"',
      },
    ]);
  });

  it("rejects CSV that omits stable source row identity", () => {
    expect(() => parseRevenueReportCsv("grossAmount\n12.000000")).toThrow(
      "CSV_MISSING_COLUMN_externalrowid",
    );
  });
});
