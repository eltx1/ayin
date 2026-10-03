# Manual financial decision authority after lock waits

Accepted195 serializes conflicting manual payout decisions. Existing AdminGuard/AuthGuard check staff roles/account availability before entering the financial transaction; a request waiting for the Payout lock could otherwise continue after that staff role was removed or the account suspended.

The manual payout decision transaction now rechecks the same existing Finance/ADMIN/SUPERADMIN scope and ACTIVE Account after the actual Payout lock. Matching account and role rows are held FOR SHARE through the financial status/ledger/audit commit. No new staff privilege, role fallback, provider operation, permission bypass, MFA/reauth/Origin change or same-state transition restriction is introduced. Failure403 occurs before financial mutation/audit/notification.

Two new real AppModule/PostgreSQL cases hold the actual payout and observe its tagged request waiter, then delete the actual Finance role or suspend the actual Account before releasing the lock. Both must leave PROCESSING, the original exact ledger reservation, zero correlated audit and zero cancellation notification. All four accepted195 transaction cases remain unchanged.

Local API source types/lint are checked separately from final-head CI/PostgreSQL/browser/review/deployment proof, which remains pending. This is manual payout authority coverage: full session/MFA revocation inside transactions, other privileged writes, provider/compliance/settings/global identity/physical-device and complete phase14/master gates remain open.
