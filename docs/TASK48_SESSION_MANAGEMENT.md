# Task 48 — Account session management

## Security model

AYIN session tokens remain signed, HTTP-only cookie or explicit bearer credentials, but every new
session is now backed by an `AccountSession` database row. The signed token contains the opaque
session UUID (`sid`); it never appears in the account API as a token or token hash. Authentication
requires all of the following on every request:

- a valid, unexpired signature and token expiry;
- an active account with the token's `authVersion`;
- a matching session owned by the token subject;
- a server-side expiry in the future and no `revokedAt` value.

This makes individual revocation effective on the next request. Global security events still bump
`authVersion` as a defense-in-depth kill switch.

## Stored session data

Each session stores its UUID, owning account, creation time, last activity, expiry, coarse device
label, auth version, and optional revocation time/reason. Last-activity writes are throttled to at
most once every five minutes per active session.

AYIN does **not** store raw session tokens, raw user-agent strings, IP addresses, IP history,
location history, advertising identifiers, or device fingerprints. A user agent is reduced at
sign-in to a short category such as `Chrome on Windows` or `Safari on iPhone`, and the raw value is
discarded. IP-derived location is intentionally omitted: it is not needed for this control and
would add privacy and accuracy costs.

## User controls

`Account → Security & sessions` displays the current session and other active sessions, including
creation, last-active and expiry times. Users can revoke one session, log out the current session,
or revoke all other sessions. API ownership always comes from the authenticated account; clients
cannot supply an account ID. Revocation and password-change operations use the existing bounded
auth rate limiter.

Password change requires the current password and defaults to revoking every other session. A user
may explicitly keep other sessions. Password reset has no trusted current session and therefore
always revokes every session. MFA disable/reset continues to bump `authVersion` and now also records
server-side revocation timestamps.

## API

- `GET /auth/sessions`
- `DELETE /auth/sessions/:sessionId`
- `POST /auth/sessions/revoke-others`
- `POST /auth/password/change`
- `POST /auth/logout` (revokes only the presented session)

Responses expose session metadata, never credentials.

## Migration and rollout

Migration `20260908234500_account_sessions` is additive and creates the table, indexes and cascading
account relation. Tokens issued before Task 48 have no `sid` and are deliberately rejected after
rollout; users sign in once to establish a manageable server-backed session. No user content or MFA
credential is changed by the migration.

## Verification

Automated coverage verifies account ownership isolation, immediate token rejection after
revocation, current-session identification, revoke-all-other behavior, expiry, logout isolation,
password change, password reset, privacy-safe device reduction, and the Account UI flow.
