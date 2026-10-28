# Task 47 — administrator multi-factor authentication

AYIN offers RFC 6238 TOTP MFA as an account-level choice, including ADMIN and SUPERADMIN.
The implementation is internal and provider-neutral: any authenticator that supports
the standard otpauth URI, SHA-1, six digits and a 30-second period can be used.
No role forces enrollment. An enabled factor is still required for sign-in until
the account owner explicitly disables it using their password and current TOTP.

## Security model

- Password authentication produces a five-minute, signed MFA challenge instead of a
  session only when MFA is enabled. Missing or unfinished enrollment allows normal
  password sign-in, including for administrators.
- Enrollment produces a QR code and manual Base32 setup key. These are returned only
  during the pending enrollment window; status and later challenge responses never
  expose the secret.
- TOTP secrets are encrypted at rest with AES-256-GCM using a domain-separated key
  derived from the production-required AUTH_TOKEN_SECRET.
- Ten 80-bit recovery codes are returned once at enrollment or regeneration. Only
  domain-separated HMAC-SHA256 hashes are persisted. Each recovery code is consumed
  atomically and cannot be replayed.
- A TOTP counter is consumed atomically. Reusing a code from the same or an older
  interval is rejected even under concurrent requests. One adjacent interval in each
  direction is accepted for bounded clock skew.
- MFA challenge, enrollment, step-up and recovery-code endpoints are limited to five
  attempts per account/IP scope in five minutes in staging/production. The existing
  multi-instance rate-limit limitation still applies: deployments with multiple API
  processes should move the counter adapter to a shared store before scaling out.
- MFA changes and recovery-code use create audit records. Audit metadata contains
  counts and actor/target identifiers, never secrets, codes or provisioning URIs.
- Password reset increments the account auth version but does not delete MFA. A
  password-reset link therefore cannot bypass the second factor.

AUTH_TOKEN_SECRET is also encryption-key material. Rotate it only through a planned
MFA migration/reset procedure; an uncoordinated rotation invalidates sessions and
makes existing encrypted TOTP secrets unreadable. Never print this secret, TOTP
secrets, provisioning URIs, authentication codes or recovery codes.

## Flows and endpoints

| Endpoint                                      | Authentication                           | Purpose                                                        |
| --------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| POST /auth/login                              | Password                                 | Returns a session for non-MFA users or an MFA challenge        |
| POST /auth/mfa/enrollment/start               | Signed enrollment challenge              | Returns one-time QR/setup material                             |
| POST /auth/mfa/enrollment/start-authenticated | Session + current password               | Starts optional MFA enrollment                                 |
| POST /auth/mfa/enrollment/verify              | Signed enrollment token + TOTP           | Enables MFA, starts a session and returns recovery codes once  |
| POST /auth/mfa/challenge                      | Signed challenge + TOTP/recovery code    | Completes login                                                |
| GET /auth/mfa/status                          | Session                                  | Returns enabled/required state and remaining-code count only   |
| POST /auth/mfa/step-up                        | Session + password (+ TOTP when enabled) | Issues a session with fresh five-minute re-authentication      |
| POST /auth/mfa/recovery-codes/regenerate      | Session + password + TOTP                | Replaces all recovery codes                                    |
| POST /auth/mfa/disable                        | Session + password + TOTP                | Disables MFA for the current account, including administrators |
| POST /admin/operations/staff/:id/mfa/reset    | Stepped-up SUPERADMIN                    | Resets another account, audits the reason and revokes sessions |

A superadministrator cannot reset their own MFA. Operations must verify the requester
through an independent channel before resetting another administrator. Never accept
an email-only request, a recovery code, or knowledge of profile data as sufficient
proof. If the last usable superadministrator loses all factors, use the controlled
database incident process with two-person approval and preserve an incident audit
trail; there is no public bypass endpoint.

## Step-up policy

The API requires a re-authentication timestamp no older than five minutes for:

- administrator role assignment/removal and MFA reset;
- account/channel/video destructive or status-changing control-plane actions;
- revenue adjustments, payout creation/status changes and payout destination reveal;
- advertising kill-switch, placement, advertiser, campaign and creative changes;
- platform setting and feature-flag changes.

Clients receiving STEP_UP_REQUIRED call POST /auth/mfa/step-up, then retry the original
operation after reviewing it again; the client never replays the mutation automatically.
Administrators and scoped staff without MFA supply their password. Accounts with
MFA enabled supply both. Current account, session, role, credential-version and
transactional authority checks remain enforced.

## Migration and rollout

Migration 20260908030000_admin_mfa only adds an enum, credential table, index and
cascading account foreign key. It does not modify account/content rows and is safe to
apply with Prisma's normal deploy migration command.

The October 2026 optional-policy update changes no stored credentials. Older
enrollments do not record whether they were voluntary or required by the former role
policy, so the release must not guess and delete existing factors. Owners with MFA
already enabled can sign in with their factor or recovery code, then choose the
authenticated turn-off action in Account settings. Turning it off revokes every
session; the next password login works normally without forced re-enrollment.

Verify password-only administrator login and sensitive-action reauthentication,
optional enrollment, enabled-factor sign-in, and authenticated opt-out in staging.
No production factor reset or enrollment is needed merely to test the release.

Clock synchronization is operationally required on API hosts and administrator
devices. Investigate repeated TOTP failures as clock drift before resetting MFA.
