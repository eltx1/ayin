export function toSafePayoutView<
  T extends {
    amount: unknown;
    destinationEncryptedSnapshot?: unknown;
    providerDestinationTokenEncryptedSnapshot?: unknown;
  },
>(payout: T) {
  const safe = { ...payout };
  delete safe.destinationEncryptedSnapshot;
  delete safe.providerDestinationTokenEncryptedSnapshot;
  return {
    ...safe,
    amount: String(payout.amount),
  };
}
