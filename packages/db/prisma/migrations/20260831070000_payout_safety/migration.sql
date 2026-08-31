-- Prevent concurrent payout requests from reserving the same creator balance twice.
-- PostgreSQL enforces the invariant atomically across creator and admin payout paths.
CREATE UNIQUE INDEX "Payout_one_active_per_channel_currency_idx"
  ON "Payout"("channelId", "currency")
  WHERE "status" IN ('PENDING', 'PROCESSING');
