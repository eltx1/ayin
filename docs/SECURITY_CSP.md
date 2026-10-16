# CSP hardening and browser acceptance

Scope: the 2026-10-16 engineering review, starting at `73f08d7`.
Installed Web dependency: Next.js **16.3.8**. No framework upgrade is part of this change.

## Fixed incompatibility

The existing consent adapter uses `pagead2.googlesyndication.com/tag/js/gpt.js` for
`LIMITED_ADS`, including the safe default. The previous enforced `script-src` did
not include that host, so browsers could reject this loader before GPT ran.
The policy now includes that exact HTTPS host. Consent selection, provider settings
and no-fill behavior are unchanged. This does not prove real Google ad delivery.

## Inventory and candidate

| Resource                                            | Current source                                                          | Candidate treatment                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Next runtime, PWA manifest/service worker           | Same origin; Next inline bootstrap                                      | Retain existing same-origin/inline behavior                                                      |
| AYIN API                                            | Build-time `NEXT_PUBLIC_API_BASE_URL`                                   | Exact normalized HTTP(S) origin                                                                  |
| HLS fetch and media                                 | Build-time `NEXT_PUBLIC_MEDIA_BASE_URL`                                 | Exact connection origin; existing media policy retained                                          |
| Direct R2 PUT                                       | Server-issued signed URL, potentially separate from public media origin | Operator-owned `AYIN_CSP_UPLOAD_ORIGIN`; never derive trust from the URL returned to the browser |
| Google SDK scripts                                  | IMA, standard GPT, limited GPT and existing legacy GPT host             | Explicit hosts retained                                                                          |
| Google ad requests, tracking, creative subresources | Provider-selected at runtime                                            | Not comprehensively inventoried; report-only observation required                                |
| Third-party images/video/frames                     | Existing media and ad inventory                                         | Existing rules retained for this first phase                                                     |
| Inline event attributes                             | No required application use identified                                  | Candidate `script-src-attr 'none'`                                                               |

Set **build-time** `AYIN_CSP_REPORT_ONLY=true` in an isolated test environment to
add the candidate `Content-Security-Policy-Report-Only` header alongside the
existing enforced header. Set `AYIN_CSP_UPLOAD_ORIGIN` to the reviewed, exact
HTTPS upload origin when testing R2. Paths, signed queries, credentials, HTTP and
wildcards are rejected. Do not copy an arbitrary creator-provided origin here.

The candidate replaces broad `https:`/`wss:` connection access with exact known
origins. Provider-selected tracking/CDN endpoints may report violations; observe
and review each required origin before considering enforcement. The candidate is
not a claim of complete Google compatibility or a strict script CSP.

There is deliberately no remote report receiver and no `report-sample` directive.
Inspect `securitypolicyviolation` events locally. Retain only directive, disposition
and redacted origin in shareable evidence; omit query strings, account paths and
signed URLs. No new log retention pipeline or paid service is introduced.

## Nonce/hash decision

The installed Next.js 16.3.8 renderer reads nonce values from request CSP headers
(`dist/server/app-render/app-render.js` and `get-script-nonce-from-header.js`).
A response-only header cannot retrofit nonces into static HTML. Next's official
guide requires dynamic rendering for per-request nonces, affecting static/ISR
page caching and server work. Therefore this change does not force all viewer
pages dynamic or add a constant/reused nonce. The existing inline-script allowance
remains a **CONFIRMED_DESIGN_GAP**, not evidence of an exploitable XSS.

A later strict-script change must choose dynamic routes versus build-generated
hashes for immutable inline scripts, propagate nonces through AYIN's dynamic
IMA/GPT script creation and JSON-LD, and validate initial loads and client
navigation. Record rendering/cache and server-resource differences before rollout.
Google's guidance recommends nonce-based strict CSP and report-only observation;
a guessed static host list is not proof of complete ad compatibility.

References consulted on 2026-10-16:

- [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy)
  (current v16 documentation; local 16.3.8 source separately checked).
- [Google Publisher Tag CSP guidance](https://developers.google.com/publisher-tag/guides/content-security-policy).
- [Google GPT loading guidance](https://developers.google.com/publisher-tag/guides/general-best-practices).

## Acceptance and rollback

Unit tests bind the enforced script policy to both real consent-selected GPT
loader URLs, reject unsafe upload-origin configuration, and verify the candidate
does not replace enforced CSP. Browser acceptance must separately show:

1. The enforced policy permits an intercepted limited-GPT fixture and rejects an
   unapproved external script without contacting an advertising provider.
2. Report-only observation preserves required application behavior.
3. Candidate enforcement on an isolated response permits the configured API and
   denies an unrelated HTTPS connection/inline event handler.
4. Public/login/Studio/Admin/upload/watch/PWA journeys pass. Real Google and R2
   remain external acceptance gates until actually exercised.

Do not promote the candidate merely because unit tests pass. Roll back candidate
observation by rebuilding with `AYIN_CSP_REPORT_ONLY=false`; the enforced policy
remains present. Reverting the code restores the previous named policy, but also
restores the limited-GPT incompatibility. Never remove CSP as a rollback mechanism.

## Authentication counter repair

Auth and upload now share a bounded fixed-window counter. Authentication retains
its production limits: 12 ordinary attempts/5 minutes and 5 MFA attempts/5 minutes.
Expired keys are cleaned in bounded batches, the 50,000-key capacity rejects new
keys instead of evicting active protection, and shutdown clears the unreferenced
cleanup timer. This is process-local protection, not a global distributed limit.
No database migration or external service is required. Rollback is a code revert,
with the former retained-key memory growth returning if reverted.
