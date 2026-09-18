# External payout provider boundary

AYIN Task 70 connects payout records to a provider-neutral transfer abstraction while deliberately
leaving real production payouts disabled until an approved provider account and adapter are supplied.

## Current production state

The registered external adapter is `UNCONFIGURED_EXTERNAL` and reports:

- `connected: false`
- `productionEnabled: false`
- no claimed cancellation support
- no claimed provider tokenization
- no claimed webhook verification

AYIN does not impersonate PayPal, Wise, Payoneer, a bank, or any other payment provider. Existing
manual payouts remain supported through the separate manual workflow.

## Adapter contract

A real approved provider adapter must implement:

- submit/create transfer using an AYIN-supplied stable idempotency key;
- retrieve transfer status;
- cancel transfer only when the provider supports cancellation;
- verify/tokenize a destination rather than requiring AYIN to keep unnecessary raw bank/card
  credentials;
- cryptographically verify webhook/event payloads when webhook processing is enabled.

AYIN refuses external production submission unless the configured adapter declares both provider
idempotency and destination tokenization support.

## Transfer state machine

Provider transfer state is separate from the existing AYIN payout state:

`READY -> SUBMITTING -> SUBMITTED/PROCESSING -> COMPLETED`

Ambiguous submission failures become `SUBMISSION_UNKNOWN`. Safe retry uses the exact same
idempotency key, is bounded, and only becomes available after a retry window. A stale
`SUBMITTING` record is converted to `SUBMISSION_UNKNOWN` before retry so a process crash cannot
silently create a second transfer.

Cancellation uses `CANCEL_REQUESTED` until provider cancellation is confirmed. Terminal transfer
states are `COMPLETED`, `FAILED`, and `CANCELLED`.

A successful transfer submission only moves the AYIN payout to `PROCESSING`. It never marks it
`PAID`. AYIN writes `PAID` only after a provider status lookup or a cryptographically verified
provider webhook reports completion.

## Financial controls

Before external submission AYIN revalidates:

- positive six-decimal-safe payout amount;
- three-letter uppercase currency;
- payout threshold;
- every reserved ledger entry is finalized or adjustment revenue;
- the reserved ledger total exactly equals the payout amount;
- the payout uses the configured provider;
- the payout has an immutable verified provider destination-token snapshot.

The existing partial unique active-payout index and ledger reservation continue preventing duplicate
creator payouts.

Definitive provider failures/cancellations release ledger reservations. Ambiguous submission states
keep funds reserved so another payout cannot be created while provider outcome is unknown.

## Events and secrets

Verified provider events are deduplicated by `(provider, externalEventId)`; raw webhook bodies are
not stored, only a SHA-256 digest and normalized event metadata.

Provider destination tokens are encrypted with AYIN's existing payout-data encryption boundary.
Ordinary APIs return only masked destination information. Manual raw destination reveal remains
limited to the audited manual payout workflow.
