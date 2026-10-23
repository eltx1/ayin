# TASK 53 — Rights, geography and maturity policy

AYIN now has one authoritative video-availability policy used by playback, catalog surfaces, search, SEO and Creator TV. Ordinary creators still get the simple default: if no policy row exists, the video is worldwide with no rights expiry or age gate.

## Ownership

- `ContentRightsDeclaration` remains the legal rights declaration. Creator rights notes continue to append to the declaration without replacing its attestation.
- `VideoPolicy` owns enforceable maturity, territory, distribution-expiry and age-gate hooks.
- Task 51 maturity/geography columns are legacy metadata only. The migration backfills their values into `VideoPolicy`; new writes target the policy domain.
- `VideoPolicyOverride` is administrative policy state. It cannot bypass publication, PRIVATE visibility, removal or channel-state boundaries.

## Territory enforcement

Territories use ISO 3166-1 alpha-2 identifiers. Free-form country text is rejected. An empty allow list plus empty block list means worldwide availability. If any geographic restriction exists and AYIN has no trusted country signal, availability is denied conservatively.

`x-ayin-region` remains personalization-only and has no rights authority. Direct requests can use Cloudflare `CF-IPCountry` only when `AYIN_TRUST_CLOUDFLARE_REGION=true`. Internal `x-ayin-edge-country` context authenticated with `AYIN_INTERNAL_EDGE_TOKEN` takes precedence over the server's own egress country. The Web server marks every such request with the non-authoritative `x-ayin-edge-context: server`, including when its token is missing. Any internal-header presence selects the internal path; missing, incorrect, duplicate or malformed credentials/context result in unknown country, without falling back to Cloudflare. Existing authenticated callers without the marker remain supported.

Web forwards a normalized ISO country only after explicit runtime trust opt-in. The production runtime additionally requires the separate `AYIN_WEB_REGION_FORWARDING=true` gate in `api.env`; legacy API-only trust never activates Web forwarding. Unknown or invalid countries are omitted; a configured token still authenticates that unknown context. Server requests reject HTTP redirects so the internal credential cannot follow a redirect to another origin. Responses remain private/no-store and contain no internal credential.

Production origins must remain protected from direct untrusted header injection. Cloudflare IP-geolocation forwarding must be enabled, and both Web and API ingress must authenticate or sanitize that header before trust is activated. A Cloudflare trace country, proxied DNS, or encrypted TLS connection alone does not establish this boundary. See the runtime-only configuration and activation procedure in `deploy/README.md`; defaults remain disabled and restricted content intentionally fails closed.

Cloudflare documents [enabling the geolocation header](https://developers.cloudflare.com/network/ip-geolocation/) separately from [authenticating origin requests](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/explanation/).

## Maturity and age hook

Maturity and age-restriction fields are product-policy signals. They are used to keep non-general/restricted videos out of kids profiles and to expose an age-gate hook to playback clients. They do **not** by themselves establish legal or regulatory compliance, perform age verification, or replace jurisdiction-specific review.

## Admin overrides

OPERATIONS and CONTENT_MODERATOR staff can set or clear FORCE_ALLOW/FORCE_BLOCK overrides only through step-up protected admin endpoints. Every mutation requires a reason and is written with an `AdminAuditLog` in the same transaction. Expiring overrides automatically stop affecting decisions after their expiry time.

## SEO

Geo-restricted or rights-expired videos are not returned as available SEO video metadata when the request is unavailable in its trusted region. Playlist SEO metadata applies the same trusted request-region decision to its video items and degrades to unavailable when none remain eligible. Sitemaps use conservative unknown-region evaluation, so only content safe for global indexing is emitted. PRIVATE content remains unavailable and UNLISTED content remains non-indexable.

## Verification scope

Policy tests cover allowed and blocked regions, fail-closed unknown regions, audited admin overrides, PRIVATE and UNLISTED playback boundaries, and Creator TV eligibility. Repository formatting, lint, typechecking, and unit/schema tests are required to pass before merge.
