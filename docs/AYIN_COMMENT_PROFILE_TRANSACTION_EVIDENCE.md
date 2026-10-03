# Comment profile suppression transaction review

Actual current-main service review found separate committed writes for profile suppression and existing-comment hiding, with no audit for hide or unhide. A second-write failure could return failure while leaving only part of the requested suppression committed.

The authorized existing operations now run in one Prisma/PostgreSQL transaction with an actor/profile/channel-scoped audit. Hide commits the suppression row, existing published-comment hiding and audit together. Unhide commits suppression removal and its audit together; it retains the established behavior of leaving previously hidden comments hidden. Existing channel ownership or scoped staff with recent verification/privileged MFA stays authoritative and is unchanged from accepted #165.

Three real AppModule/PostgreSQL regressions cover successful hide/unhide/audit and late database-trigger failures in each audit write, asserting rollback of all companion changes. The trigger exists only inside isolated integration tests and is removed in finally; no production schema/migration change. Full exact-head CI/database/browser results remain pending.

This focused correction does not certify concurrent comment-creation versus suppression, all moderation actions, global authorization-change races, large-data performance or completion of master phases0–16.
