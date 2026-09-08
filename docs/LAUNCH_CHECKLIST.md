# AYIN V1 Launch Checklist

Use this as a release gate. A box is checked only from evidence in the target environment; repository defaults do not count as production verification.

The V1 zero-additional-service topology keeps Web/API/PostgreSQL and the isolated media-processing worker on the existing EC2 host. Cloudflare R2 remains the external video media storage layer.

## DNS and domains

- [ ] `ayin.stream` resolves through the intended Cloudflare zone to the CloudPanel web origin.
- [ ] `api.ayin.stream` resolves to the API origin and is not accidentally cached as static content.
- [ ] `media.ayin.stream` resolves to R2 separately from AWS/CloudPanel.
- [ ] HTTPS is valid end to end and HTTP redirects to HTTPS.

## CloudPanel and application health

- [ ] Web process is running under the documented PM2 configuration.
- [ ] API process is running and `/health` returns success through the public reverse proxy.
- [ ] `ayin-media-worker` is running under PM2 with the pinned FFmpeg/ffprobe runtime available and healthy.
- [ ] Nginx forwards host/proto/client information as documented.
- [ ] Restart and rollback procedure from `deploy/README.md` has been exercised before public launch.

## PostgreSQL

- [ ] PostgreSQL 16+ is running on the existing AYIN EC2 application host.
- [ ] PostgreSQL listens on `127.0.0.1:5432` only and never on `0.0.0.0`, `[::]` or a public/VPC-facing address.
- [ ] EC2 Security Groups do not expose TCP/5432.
- [ ] Dedicated database `ayin` and application role `ayin_app` are used; no Horus database/user is reused.
- [ ] Production `DATABASE_URL` is stored outside git with mode `600`.
- [ ] `pnpm db:migrate:deploy` succeeds before public acceptance.
- [ ] Dedicated private R2 bucket `ayin-production-db-backups` exists outside the EC2/EBS failure domain and is not the media bucket.
- [ ] Backup-bucket credentials are least privilege, server-only, and stored outside git with mode `600`.
- [ ] The production host contains only the public `age` backup recipient; the matching private recovery identity is held off-host.
- [ ] `ayin-postgres-backup.timer` is enabled, active and scheduled daily; `/home/ayin/backup-status/latest.json` records a verified success no older than 26 hours.
- [ ] A real production backup has passed remote re-download + SHA-256 integrity verification.
- [ ] At least one real encrypted R2 backup has been restored into an `ayin_restore_*` non-production database and produced a successful Task 44 restore report including PostgreSQL, Prisma migration and application smoke checks.
- [ ] RPO target (24h), RTO target (4h), 35-day retention and recovery owner are accepted by operations.

## R2 and media delivery

- [ ] R2 account, bucket and least-privilege credentials are configured outside git.
- [ ] `media.ayin.stream` serves byte-range requests required by progressive MP4 playback.
- [ ] CORS permits only required upload/media origins and methods.
- [ ] Abandoned multipart uploads/drafts have an operational cleanup policy.
- [ ] Upload a real iPhone/QuickTime MOV source directly to R2, observe queued processing complete, publish the resulting validated canonical MP4, seek it, and resume it on the target environment.
- [ ] Repeat the processing smoke with at least one additional common mobile/camera source container supported by the upload flow.
- [ ] Raw/source media is never exposed through public discovery/playback before canonical-media validation succeeds.
- [ ] Creator upload bytes bypass the public Web/API/Nginx upload path; EC2 media-worker processing is isolated and final playback media remains stored in R2 rather than as durable application-host video storage.

## Authentication and email

- [ ] `AUTH_TOKEN_SECRET` and `UPLOAD_SESSION_SECRET` are unique production secrets and have rotation ownership.
- [ ] Session cookies are Secure/HttpOnly/SameSite as intended through the deployed proxy.
- [ ] Register, login and logout succeed on the production domains.
- [ ] Every ADMIN and SUPERADMIN has completed TOTP enrollment, stored recovery codes
      in an approved password manager, and passed an admin-login/step-up smoke test.
- [ ] At least two active superadministrators can perform the audited, two-person MFA
      reset procedure documented in docs/TASK47_ADMIN_MFA.md.
- [ ] Any transactional email provider required by enabled product flows is configured and tested; do not advertise email-dependent flows before it is live.

## Advertising

- [ ] Emergency ad kill switch is verified.
- [ ] House/direct fallback works when external fill is unavailable.
- [ ] `ads.txt` and `app-ads.txt` contain only seller/publisher identifiers actually supplied by the relevant account/partner.
- [ ] Remove every placeholder before claiming an external seller relationship.
- [ ] Supply the real Google Ad Manager network/ad-unit/seller data to the completed Task 36 integration boundary, then verify test line items, consent, fill, reporting and target devices.

## Legal and policy

- [ ] Privacy policy is published and matches actual analytics/advertising/data behavior.
- [ ] Terms of service are published.
- [ ] Content/community policy and reporting/takedown path are published.
- [ ] Rights confirmation is visible in creator publishing flows.
- [ ] Moderation/takedown operational owner is assigned.

## Admin and operations

- [ ] At least one intended superuser/admin account is provisioned through a controlled process.
- [ ] Admin RBAC is verified from a non-admin account and an admin account.
- [ ] Suspension/unpublish/moderation actions are audited.
- [ ] No default/test admin credentials exist in production.

## Analytics and revenue sanity

- [ ] Page/content/playback/social/upload/TV/ad events arrive without leaking raw secrets.
- [ ] Event volume is within expected write rate and retention policy is running.
- [ ] Creator analytics numbers are sampled against database facts.
- [ ] Revenue contract math is checked with a known gross/net example before any payout is approved.
- [ ] Payment execution remains disabled until a real payment rail and operating procedure exist.

## Security headers and edge behavior

- [ ] CSP works with required AYIN, R2 and approved Google advertising origins without broad wildcard relaxation.
- [ ] `X-Content-Type-Options`, frame protections, referrer policy and permissions policy are present at the public edge.
- [ ] Cookie-authenticated cross-origin mutation attempts are rejected.
- [ ] Rate limits are effective for auth, comments, search, upload session creation and reports.
- [ ] Cloudflare/CloudPanel does not strip or replace required application security headers unexpectedly.

## Error monitoring

- [ ] Production error monitoring/logging is configured with secrets/PII redaction using existing infrastructure before adding a paid monitoring service.
- [ ] API process crashes/restarts are detectable and have an operational owner.
- [ ] Media-worker crashes, queue stalls and repeated processing failures are detectable and have an operational response path.
- [ ] Health-check failure and elevated 5xx rate have an operational response path.
- [ ] R2/media delivery failures can be distinguished from API/web/media-processing failures.
- [ ] Backup unit failure or absence of a verified backup for more than 26 hours has an operational alert/response path.

## Final acceptance

- [ ] Run `pnpm test:e2e` against the release candidate with the isolated E2E storage adapter only in `APP_ENV=test`, or against an explicitly safe R2 test environment.
- [ ] `PostgreSQL backup restore acceptance` CI is green for the release candidate.
- [ ] Register -> automatic profile/channel/Uploads/TV verified.
- [ ] Direct source upload -> processing -> validated canonical media -> publish -> channel/Uploads/Creator TV verified.
- [ ] Watch -> progress -> resume verified.
- [ ] Subscribe/like/comment verified.
- [ ] Admin user/channel/video/media-processing controls and homepage merchandising verified.
- [ ] Video-ad failure does not block content and display no-fill collapses.
- [ ] Revenue contract smoke and moderation/suspension smoke pass.

## Rollback

- [ ] Previous release path is known before deployment.
- [ ] Database migration compatibility/rollback implications are reviewed before switching the `current` symlink.
- [ ] A verified backup/recovery point exists before a migration with material data-loss risk.
- [ ] PM2 rollback and public health checks are documented and executable.
- [ ] Incident owner knows how to activate maintenance/ad kill switches without code edits.
