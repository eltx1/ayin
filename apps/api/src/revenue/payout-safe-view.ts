export function toSafePayoutView<
  T extends {
    amount: unknown;
    destinationEncryptedSnapshot?: unknown;
  },
>(payout: T) {
  const { destinationEncryptedSnapshot: _redacted, ...safe } = payout;
  return {
    ...safe,
    amount: String(payout.amount),
  };
}
