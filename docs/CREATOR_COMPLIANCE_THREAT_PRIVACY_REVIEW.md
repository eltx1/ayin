# Creator compliance threat and privacy review

## Scope

AYIN Task 71 adds the technical workflow for creator identity, tax, payout-destination, and payout
eligibility status. It does not turn AYIN into a KYC-document or tax-document vault and it does not
encode country-specific tax law.

## Data minimization

AYIN stores normalized workflow status only:

- identity status;
- tax-information status;
- payout-destination status;
- the configured compliance provider name;
- an encrypted opaque provider profile reference when an approved external provider needs one;
- the last provider-status check timestamp.

AYIN does **not** introduce fields for tax IDs, national identity numbers, passport/document
numbers, document images, document URLs, bank/card numbers, or external verification-session URLs.

When an approved provider workflow returns a redirect/action URL, AYIN returns it directly to the
authenticated creator response with `no-store`; it is not persisted. The provider profile
reference is encrypted using AYIN's existing sensitive payout-data encryption boundary.

## Requirement authority

The default adapter is `UNCONFIGURED_COMPLIANCE` and declares no identity, tax, or destination
verification requirements. AYIN does not infer tax forms or legal obligations from a creator's
country code.

A future production adapter may report requirements only when backed by the approved provider or
approved legal configuration. The requirement response carries a source and optional version so
operators can distinguish provider/legal requirements from AYIN application logic.

## Payout gating

Identity, tax, and payout destination remain separate states. Payout compliance eligibility is
derived from the configured requirements:

- a required identity check must be `VERIFIED`;
- required tax information must be `VERIFIED`;
- required destination verification must be `VERIFIED`.

No configured requirement means AYIN does not invent a blocker.

The existing payout controls remain independent: finalized earnings, threshold, active-payout
prevention, payout-provider readiness, and destination configuration still apply. Task 71 adds the
compliance gate to payout creation and rechecks it immediately before external provider submission.

## Admin access and overrides

Finance admins receive status-only visibility. The UI does not expose identity documents, tax IDs,
bank data, document URLs, external provider references, or verification-session tokens.

Status overrides require step-up authentication and a written reason. Every override records the
field, previous status, new status, actor, and reason in the audit log. The audit event explicitly
records that raw identity, tax, and bank data were not accessed.

## Logging

Audit metadata may contain:

- creator/channel IDs;
- provider name;
- workflow name;
- normalized statuses;
- whether a redirect action was returned.

Audit metadata must not contain:

- tax IDs;
- identity document numbers;
- bank/card/account data;
- identity/tax document URLs;
- external provider profile references;
- provider verification-session tokens.

## Threats and controls

**Document-vault expansion:** mitigated by not providing document upload/storage models for
compliance.

**Sensitive-value leakage through logs:** mitigated by status-only audit payloads and by never
including provider references or action URLs in audit metadata.

**Country-rule drift or invented legal logic:** mitigated by keeping the disabled adapter
requirement-free and sourcing any future requirements through an approved provider/legal adapter.

**Payout before required verification:** mitigated by compliance gating at payout creation and a
second check before an external payout submission.

**Admin abuse or accidental override:** mitigated by finance-role authorization, MFA behavior from
the existing admin guard, step-up authentication, mandatory override reasons, and immutable audit
records.

**Stale provider status:** the external workflow supports explicit status retrieval. The stored
`complianceLastCheckedAt` timestamp makes freshness visible without storing provider payloads.

## Production enablement

No production compliance provider is selected or impersonated by Task 71. External workflows remain
disabled until an approved provider/account adapter is explicitly configured.
