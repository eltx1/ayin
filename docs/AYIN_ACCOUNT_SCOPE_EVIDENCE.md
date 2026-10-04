# Account session scope and synchronous privacy foundation

## Problem and scope

An account session panel could retain account A's records while another tab or login changed the cookie to B. A password command using a password shared by A and B could then affect B. A pre-command identity check alone cannot stop a cookie switch between that check and the protected command.

This focused change adds optional `x-ayin-expected-account` checking after actual authentication and before controller execution. Missing headers preserve legacy callers; malformed, repeated, empty and padded values reject with 400; a different valid account rejects with 409 ACCOUNT_CHANGED. Explicit Authorization retains precedence and never falls back to a cookie. This header narrows existing authenticated authority and never grants it.

The session client verifies fresh identity before and after each private read or command, sends the expected account on the protected request and validates the actual response before treating a command as acknowledged. Whole read/write deadlines are 15/30 seconds including actor calls and response parsing. Decoded command acknowledgment is retained as a known outcome when post-command identity changes, without returning the old account's facts. Only a validated intentional current-session logout skips post-identity. There is no automatic command replay.

The session panel hides its private DOM synchronously before resetting password inputs, aborts current work, invalidates late results and clears session facts and private acknowledgments on account loss or pagehide/hidden visibility. Pageshow never restarts work. Manual read is required to restore verified facts. Password responses that remain uncertain clear password fields and disable further commands pending explicit review. Successful commands remain distinct from failed list refreshes.

## Verification state

Local server assertion tests passed 4 cases. Production API declaration build, Web types, focused lint and strict browser-spec types passed during preparation. New transport tests include account-switch rejection, exact JSON and bodyless DELETE, post-read data discard, post-write known acknowledgment, lost/malformed responses, safe error projection, intentional logout and whole 15/30-second deadlines. Final local and own CI counts must be recorded after execution rather than inferred.

Six real PostgreSQL cases are authored: private-read zero service calls, same-password wrong-account write rejection, deletion without requests/audits, revocation without changed sessions, strict scope/legacy behavior, and explicit bearer priority. Four real browser cases cover switches before and after actor verification, first synchronous pagehide concealment before secret reset with no pageshow traffic, and post-private-read result discard. These authored cases are not execution proof until owning CI completes.

## Boundaries and continuation

This work covers the security/session panel and the optional server scope boundary. Account overview, privacy/export, MFA and finance require coordinated cross-panel identity/lifecycle review. Server scope checking does not replace under-lock authority/password revalidation for other domain writes. Physical device, memory erasure, privacy deletion certification and all 17 master phases remain open.

The workspace was restored from independently hashed tracked-source artifact 11307155014 (SHA25642432b851790134ea300f3a3eafe5f5ff1135ebfc7526effe846d5359311fc0e), whose nested git archive identified a809f7b4c441a72784c7f3a6e81f22102a93a8fb. Temporary recovery PR233 was closed without merging; its workflow is excluded from this focused change. No unpublished work from the replaced workspace is treated as accepted evidence.

## Neighboring MFA lifecycle correction

Review of the real account page found that the MFA sibling reloaded the page automatically on persisted pageshow. That could restart private session reads despite the session panel's freeze. MFA now hides its own private DOM synchronously before clearing setup/recovery secrets, aborts its work and closes its local scope on pagehide or hidden visibility. Pageshow and focus cannot restart work after that closure. The existing explicit Reload account action remains available with a truthful recovery message. A real browser case prepares an actual enrollment QR, observes its presence at the first native hidden-property assignment while visibility is already false, checks zero subsequent reads/writes/navigation on pageshow/focus, then explicitly reloads. Existing account-switch and MFA command behavior still require owning regression gates.

A broad local Vitest invocation included integration cases without a local PostgreSQL service and failed the health/database cases; it is not successful PG evidence. The appropriate API source-only suite passed all 408 unit tests. Real PostgreSQL race execution remains owning CI's responsibility. The static first-hide expectation was corrected before acceptance to include the observer's actual firstHide field; no assertion was removed.
