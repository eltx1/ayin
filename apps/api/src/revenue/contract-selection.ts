export interface EffectiveContractCandidate {
  id: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
  revenueShareBps: number | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export function selectEffectiveContract<T extends EffectiveContractCandidate>(
  contracts: T[],
  at: Date,
): T | null {
  return (
    contracts
      .filter(
        (contract) =>
          contract.status === "ACTIVE" &&
          contract.revenueShareBps !== null &&
          (!contract.effectiveFrom || contract.effectiveFrom <= at) &&
          (!contract.effectiveTo || contract.effectiveTo > at),
      )
      .sort((left, right) => {
        const leftTime = left.effectiveFrom?.getTime() ?? Number.MIN_SAFE_INTEGER;
        const rightTime = right.effectiveFrom?.getTime() ?? Number.MIN_SAFE_INTEGER;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return right.id.localeCompare(left.id);
      })[0] ?? null
  );
}
