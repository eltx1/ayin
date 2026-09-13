# TASK 53 — Rights, geography and maturity policy

AYIN now has one authoritative video-availability policy used by playback, catalog surfaces, search, SEO and Creator TV. Ordinary creators still get the simple default: if no policy row exists, the video is worldwide with no rights expiry or age gate.

## Ownership

- `ContentRightsDeclaration` remains the legal rights declaration. Creator rights notes continue to append to the declaration without replacing its attestation.
- `VideoPolicy` owns enforceable maturity, territory, distribution-expiry and age-gate hooks.
- Task 51 maturity/geography columns are legacy metadata only. The migration backfills their values into `VideoPolicy`; new writes target the policy domain.
- `VideoPolicyOverride` is administrative policy state. It cannot bypass publication, PRIVATE visibility, removal or channel-state boundaries.

## Territory enforcement

Territories use ISO 3166-1 alpha-2 identifiers. Free-form country text is rejected. An empty allow list plus empty block list means worldwide availability. If any geographic restriction exists and AYIN has no trusted country signal, availability is denied conservatively.

`x-ayin-region` remains personalization-only and has no rights authority. Enforcement accepts either Cloudflare `CF-IPCountry` when `AYIN_TRUST_CLOUDFLARE_REGION=true`, or an internal `x-ayin-edge-country` header authenticated with `AYIN_INTERNAL_EDGE_TOKEN`. Production origins must remain protected from direct untrusted header injection. Deployments must enable only a region source that is guaranteed to be set or authenticated by trusted edge infrastructure; otherwise restricted content intentionally fails closed.

## Maturity and age hook

Maturity and age-restriction fields are product-policy signals. They are used to keep non-general/restricted videos out of kids profiles and to expose an age-gate hook to playback clients. They do **not** by themselves establish legal or regulatory compliance, perform age verification, or replace jurisdiction-specific review.

## Admin overrides

OPERATIONS and CONTENT_MODERATOR staff can set or clear FORCE_ALLOW/FORCE_BLOCK overrides only through step-up protected admin endpoints. Every mutation requires a reason and is written with an `AdminAuditLog` in the same transaction. Expiring overrides automatically stop affecting decisions after their expiry time.

## SEO

Geo-restricted or rights-expired videos are not returned as available SEO video metadata when the request is unavailable in its trusted region. Playlist SEO metadata applies the same trusted request-region decision to its video items and degrades to unavailable when none remain eligible. Sitemaps use conservative unknown-region evaluation, so only content safe for global indexing is emitted. PRIVATE content remains unavailable and UNLISTED content remains non-indexable.

## Verification scope

Policy tests cover allowed and blocked regions, fail-closed unknown regions, audited admin overrides, PRIVATE and UNLISTED playback boundaries, and Creator TV eligibility. Repository formatting, lint, typechecking, and unit/schema tests are required to pass before merge.
