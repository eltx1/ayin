# AYIN V1 security hardening

This document records the repository-side security controls reviewed in Task 27. It is not a claim that an unobserved production environment has been penetration-tested.

## Authentication and sessions

- Passwords are hashed with salted scrypt and compared with constant-time primitives.
- New/reset passwords require 10–128 characters; AYIN deliberately avoids composition rules that encourage predictable passwords.
- Production requires `AUTH_TOKEN_SECRET` with at least 32 characters. The local fallback secret is not accepted for production.
- Browser sessions use `HttpOnly`, `SameSite=Lax` cookies and add `Secure` in staging/production. Native/thin-shell clients can explicitly request bearer transport.
- Auth registration/login/reset entry points are rate limited and session invalidation remains server controlled.

## CSRF, CORS and browser isolation

The API allows credentialed CORS only from the configured AYIN web origin. Unsafe requests authenticated by the session cookie must also carry an exact matching `Origin` header. Bearer-authenticated platform clients are not forced through browser CSRF semantics.

The web app sets CSP, frame, content-type, referrer, permissions and opener policies. CSP keeps Google Publisher Tag/IMA endpoints available and permits HTTPS media/R2 origins without allowing arbitrary inline object/embed content. React remains the rendering boundary for user text; repository review found no `dangerouslySetInnerHTML` use for user-generated text.

## Authorization and object ownership

Creator/admin mutations remain guarded server-side. Admin controllers use both `AuthGuard` and `AdminGuard`. Upload sessions are account- and channel-bound signed tokens. Every resume/part/complete/abort operation rechecks token expiry, account ownership, OWNER membership and immutable media-asset fields in PostgreSQL, preventing a token or asset ID from becoming an IDOR shortcut.

Prisma query builders remain the database access path; repository review found no `queryRawUnsafe` call. User-provided IDs/filters are validated and parameterized by Prisma.

## Abuse controls

Production rate limits cover authentication, search, comment create/edit/delete, comment reports, trust reports/takedowns/appeals, and upload-session creation. These controls intentionally avoid CAPTCHA/manual review by default.

## Media draft lifecycle

`MediaUploadService.cleanupAbandonedUploads(olderThan)` aborts stale R2 multipart uploads, deletes stale draft objects when possible, and marks stale pending source assets rejected. Operations should invoke this cleanup on a recurring job with a retention threshold appropriate to the upload URL/session TTL; failure of cleanup must be observable but must not block playback. R2 lifecycle rules may be used as a secondary safety net, not as a replacement for database state cleanup.

## Secrets and deployment

Production environment files live outside Git and deployment uses exact commits. R2, auth, analytics, mail and advertising credentials must never be placed in `NEXT_PUBLIC_*`, repository files, workflow logs or client-visible configuration. The optional production deploy workflow is disabled until explicit repository variables/secrets are configured.

## Advertising hardening

Direct campaign API responses convert Prisma `BigInt` impression goals to JSON-safe numbers within the schema's `Number.MAX_SAFE_INTEGER` bound. Direct ad decisions also reject missing/disabled logical placements before evaluating campaigns. The emergency advertising kill switch remains the first global control.

## Remaining live verification

Before production launch, validate actual Cloudflare/CloudPanel response headers, cookie flags, proxy IP trust/rate-limit behavior, R2 lifecycle configuration and Google ad execution against the deployed domains. These checks require the live environment and are not represented as completed by repository tests.
