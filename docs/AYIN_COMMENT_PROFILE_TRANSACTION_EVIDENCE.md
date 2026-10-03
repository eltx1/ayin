# Comment profile suppression transaction review

Actual current-main service review found separate committed writes for profile suppression and existing-comment hiding, with no audit for hide or unhide. A second-write failure could return failure while leaving only part of the requested suppression committed.

The authorized existing operations now run in one Prisma/PostgreSQL transaction with an actor/profile/channel-scoped audit. Hide commits the suppression row, existing published-comment hiding and audit together. Unhide commits suppression removal and its audit together; it retains the established behavior of leaving previously hidden comments hidden. Existing channel ownership or scoped staff with recent verification/privileged MFA stays authoritative and is unchanged from accepted #165.

Five real AppModule/PostgreSQL regressions cover successful hide/unhide/audit and late database-trigger failures in each audit write, asserting rollback of all companion changes. A second source review also found comment creation checking suppression before committing its comment, so it could pass the check while a hide committed. Creation and hide/unhide now lock the existing ViewerProfile row before reading/writing suppression and comments; first-time suppression is covered without a new table/index or hashed advisory-lock protocol. Two real row-lock tests observe the waiting request in pg_stat_activity and verify creation denies after suppression commits, and hide includes a comment that committed before it acquired the lock.

The trigger exists only inside isolated integration tests and is removed in finally; no production schema/migration change. Full exact-head CI/database/browser results remain pending.

This focused correction does not certify all moderation actions, global authorization-change races, large-data performance or completion of master phases0–16.
