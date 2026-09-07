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

## Database backup and recovery security

Task 44 keeps database recovery separate from the public media boundary:

- database backups use the dedicated private `ayin-production-db-backups` R2 bucket, never `ayin-production-media`;
- the backup bucket has no AYIN public media domain or browser CORS requirement;
- R2 credentials used by backup are dedicated to the backup bucket and are stored only in `/home/ayin/env/backup.env` with mode `600`/`400`;
- PostgreSQL passwords and R2 secrets are not passed on process command lines and are never intentionally printed;
- every PostgreSQL archive is encrypted client-side with `age` before upload over HTTPS;
- production stores only the public age recipient. The matching private recovery identity is held off the EC2 failure domain;
- encrypted objects use unique UTC-dated keys and the backup script refuses an existing object key rather than replacing it;
- remote ciphertext is downloaded again and checked against SHA-256 before the run can be marked successful;
- automated restore verification accepts only new `ayin_restore_*` databases and refuses the production database name or an existing target database;
- restore reports contain only operational metadata/check results, not row contents, credentials or decrypted backup material.

Plaintext dump and decrypted restore files exist only in mode-restricted temporary directories and are deleted on exit. CI restore acceptance generates synthetic PostgreSQL data and an ephemeral age identity; no production backup or production secret is copied into GitHub Actions.

See `docs/TASK44_BACKUP_RESTORE.md` for RPO/RTO, retention, timer setup and the incident recovery procedure.

## Advertising hardening

Direct campaign API responses convert Prisma `BigInt` impression goals to JSON-safe numbers within the schema's `Number.MAX_SAFE_INTEGER` bound. Direct ad decisions also reject missing/disabled logical placements before evaluating campaigns. The emergency advertising kill switch remains the first global control.

## Remaining live verification

Before production launch, validate actual Cloudflare/CloudPanel response headers, cookie flags, proxy IP trust/rate-limit behavior, R2 lifecycle configuration and Google ad execution against the deployed domains. Also validate one real encrypted database backup from the private backup bucket with a non-production restore drill; repository/CI tests alone do not establish that production credentials, scheduling and off-host key custody are correct.
