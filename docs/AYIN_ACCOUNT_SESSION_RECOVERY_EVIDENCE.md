# Viewer account session acknowledgment recovery

Prepared focused source; full CI and original-image review are pending. This does not close the complete Viewer/account matrix.

Current deployed source read during this review combined successful session/password commands with the following list refresh in a single catch. A later failed read therefore mislabeled an already committed operation. The change parses actual acknowledgments before showing success, preserves that success across failed refresh, clears the stale session list and requires explicit current-session reading before another command. An unconfirmed or malformed command response locks further commands and is never automatically replayed. A synchronous pending ref prevents two same-turn clicks from issuing duplicate operations. Reads are bounded to15 seconds and commands to30 seconds, including response parsing.

Session lists are projected to safe actual fields and validate dates, identities, current/status flags, duplicate rows and multiple current sessions. Revocation acknowledgments must agree with the captured current-session decision; password acknowledgments require changed:true and a safe actual revocation count. Unknown failures are displayed using localized recovery text. Six unit cases cover these response boundaries.

Four prepared real browser cases cover EN/AR actual revoke-others success followed by controlled503 refresh and explicit recovery, two synchronous clicks issuing one command, a real committed password change whose response is lost, and a real session revocation followed by a malformed acknowledgment. They verify revoked bearer rejection and actual old/new password login results. Four scoped original images are requested.

This slice changes only the account security session component. Whole account identity-transition protection, private freeze across all account panels, privacy/MFA flow coordination and server current-authority races remain open and are not certified here.
