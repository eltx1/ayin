export function toSafePayoutView<
  T extends {
    amount: unknown;
    destinationEncryptedSnapshot?: unknown;
  },
>(payout: T) {
  const safe = { ...payout };
  delete safe.destinationEncryptedSnapshot;
  return {
    ...safe,
    amount: String(payout.amount),
  };
}
