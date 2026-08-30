const MONEY_SCALE = 1_000_000n;

export function parseMoneyMicros(value: string): bigint {
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error("INVALID_MONEY");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(6, "0"));
  return sign * (whole * MONEY_SCALE + fraction);
}

export function formatMoneyMicros(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / MONEY_SCALE;
  const fraction = String(absolute % MONEY_SCALE).padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

export function applyRevenueShareMicros(grossMicros: bigint, revenueShareBps: number): bigint {
  if (!Number.isInteger(revenueShareBps) || revenueShareBps < 0 || revenueShareBps > 10_000) {
    throw new Error("INVALID_REVENUE_SHARE");
  }
  const numerator = grossMicros * BigInt(revenueShareBps);
  if (numerator >= 0n) return (numerator + 5_000n) / 10_000n;
  return (numerator - 5_000n) / 10_000n;
}

export function compareMoneyStrings(left: string, right: string): number {
  const a = parseMoneyMicros(left);
  const b = parseMoneyMicros(right);
  return a === b ? 0 : a > b ? 1 : -1;
}
