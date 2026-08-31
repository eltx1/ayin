# AYIN pre-server production readiness

This document records the production gates discovered after the brand, Creator Monetization and Admin Control Center merge. It is intentionally scoped to repository and operations readiness; it does not authorize deployment or change the direct-to-R2 media architecture.

## P0 — required before public production

### Repository-side controls implemented in this hardening change

- Database-backed `GET /ready` endpoint while preserving database-independent `GET /health` liveness.
- Nest shutdown hooks so Prisma cleanup runs on supervised termination signals.
- Release candidate build before production migrations.
- Automatic application symlink/PM2 rollback when post-switch web or API readiness fails; database migrations are never automatically reversed.
- CI syntax validation for the production release script.
- Production runbook explicitly separates liveness, readiness, application rollback, database recovery and R2 operational checks.

### External infrastructure gates that cannot be truthfully completed in the repository

- Protect `main` with required quality/browser checks and an appropriate review policy.
- Configure and test PostgreSQL backup/PITR, define RPO/RTO and complete a restore drill before production data is at risk.
- Configure HTTPS-only/HSTS, WAF/reverse-proxy rate limiting and request limits at the actual Cloudflare/CloudPanel edge.
- Verify production secrets, least-privilege access and rotation/recovery for authentication, database, R2 and payout-encryption keys.
- Verify live R2 CORS, presigned URL expiry/content constraints, lifecycle rules and orphan-object reconciliation without changing the current direct-to-R2 architecture.

## P1 — complete early in production hardening

- Add production structured logs, request/correlation IDs, metrics, traces, alerting and service-level indicators using a vendor-neutral telemetry boundary.
- Move brute-force/rate-limit state to a shared backend if the API runs more than one process/host, while keeping edge rate limits as a separate control.
- Require phishing-resistant MFA/passkeys or an equivalent strong second factor for privileged Admin, SUPERADMIN and finance roles.
- Add finance dual-control/reconciliation procedures, encryption-key rotation strategy, audit-log retention and production payout-provider controls before automated real-money payout integrations.
- Add transactional email delivery for verification, password/security notifications and finance-critical alerts before those user-facing workflows claim delivery.
- Add stronger R2 upload integrity checks, MIME/size enforcement, checksums where practical and scheduled cleanup/reconciliation of abandoned objects.
- Stream or paginate very large financial CSV statements instead of relying on unbounded in-memory export assembly.

## P2 — scale and platform maturity

- Scale search/recommendation indexing and caching based on measured production load.
- Expand copyright/DMCA, age/territory controls and moderation operations.
- Complete WCAG 2.2 keyboard/focus/caption checks and TV remote-navigation testing.
- Treat ABR/HLS/CMAF, captions packaging, DRM, IMA/DAI/SSAI and any alternate media pipeline as separate future architecture work requiring explicit approval; none is a prerequisite for preserving the current playback-ready MP4/R2 launch architecture.
