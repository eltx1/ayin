import { createHash } from "node:crypto";

export type ReconciliationStatus =
  "MATCHED" | "UNMATCHED" | "DUPLICATE" | "CORRECTED" | "FINALIZED" | "ANOMALOUS";

export interface ReconciliationSnapshot {
  state: "ESTIMATED" | "FINAL";
  currency: string;
  periodStart: string;
  periodEnd: string;
  channelId: string;
  videoId: string | null;
  grossMicros: bigint;
  creatorMicros: bigint;
}

export interface LedgerEffect {
  key: "PRIMARY" | "RETIRE_ESTIMATE";
  type: "AD_REVENUE" | "ADJUSTMENT";
  state: "ESTIMATED" | "FINAL" | "ADJUSTMENT";
  grossMicros: bigint;
  creatorMicros: bigint;
  finalized: boolean;
  primary: boolean;
}

export function classifyReconciliation(
  previous: ReconciliationSnapshot | null,
  current: ReconciliationSnapshot,
): { status: ReconciliationStatus; reason: string } {
  if (!previous) {
    return current.state === "FINAL"
      ? { status: "FINALIZED", reason: "First resolved source row is final." }
      : { status: "MATCHED", reason: "Source row matched internal attribution." };
  }

  if (
    previous.currency !== current.currency ||
    previous.periodStart !== current.periodStart ||
    previous.periodEnd !== current.periodEnd
  ) {
    return {
      status: "ANOMALOUS",
      reason: "External row identity was reused with a different period or currency.",
    };
  }

  if (previous.channelId !== current.channelId || previous.videoId !== current.videoId) {
    return {
      status: "ANOMALOUS",
      reason: "External row identity was reused with different resolved attribution.",
    };
  }

  if (previous.state === "FINAL" && current.state === "ESTIMATED") {
    return {
      status: "ANOMALOUS",
      reason: "A finalized source row cannot regress to estimated.",
    };
  }

  if (
    previous.state === current.state &&
    previous.grossMicros === current.grossMicros &&
    previous.creatorMicros === current.creatorMicros
  ) {
    return { status: "DUPLICATE", reason: "Source row is identical to the prior import." };
  }

  if (previous.state === "ESTIMATED" && current.state === "FINAL") {
    return {
      status: "FINALIZED",
      reason: "Final source row appended without replacing the historical estimate.",
    };
  }

  if (previous.state === current.state) {
    return {
      status: "CORRECTED",
      reason: "Source amount changed; an append-only ledger delta is required.",
    };
  }

  return {
    status: "ANOMALOUS",
    reason: "Source row transition does not match a supported reconciliation transition.",
  };
}

export function buildLedgerEffects(
  status: ReconciliationStatus,
  current: ReconciliationSnapshot,
  previous: ReconciliationSnapshot | null,
): LedgerEffect[] {
  if (status === "MATCHED") {
    return [
      {
        key: "PRIMARY",
        type: "AD_REVENUE",
        state: "ESTIMATED",
        grossMicros: current.grossMicros,
        creatorMicros: current.creatorMicros,
        finalized: false,
        primary: true,
      },
    ];
  }

  if (status === "FINALIZED") {
    const effects: LedgerEffect[] = [];
    if (previous?.state === "ESTIMATED") {
      effects.push({
        key: "RETIRE_ESTIMATE",
        type: "AD_REVENUE",
        state: "ESTIMATED",
        grossMicros: -previous.grossMicros,
        creatorMicros: -previous.creatorMicros,
        finalized: false,
        primary: false,
      });
    }
    effects.push({
      key: "PRIMARY",
      type: "AD_REVENUE",
      state: "FINAL",
      grossMicros: current.grossMicros,
      creatorMicros: current.creatorMicros,
      finalized: true,
      primary: true,
    });
    return effects;
  }

  if (status !== "CORRECTED" || !previous) return [];

  const grossDelta = current.grossMicros - previous.grossMicros;
  const creatorDelta = current.creatorMicros - previous.creatorMicros;
  if (current.state === "FINAL") {
    return [
      {
        key: "PRIMARY",
        type: "ADJUSTMENT",
        state: "ADJUSTMENT",
        grossMicros: grossDelta,
        creatorMicros: creatorDelta,
        finalized: true,
        primary: true,
      },
    ];
  }

  return [
    {
      key: "PRIMARY",
      type: "AD_REVENUE",
      state: "ESTIMATED",
      grossMicros: grossDelta,
      creatorMicros: creatorDelta,
      finalized: false,
      primary: true,
    },
  ];
}

export function buildReconciliationLedgerKey(input: {
  source: string;
  sourceReportId: string;
  externalRowId: string;
  effect: string;
}) {
  const digest = createHash("sha256")
    .update(
      [input.source, input.sourceReportId, input.externalRowId, input.effect].join("\u001f"),
      "utf8",
    )
    .digest("hex");
  return `recon:${digest}`;
}
