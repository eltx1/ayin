# Moderation, rights and creator trust

Task 24 keeps publishing UX simple while retaining the existing versioned `ContentRightsDeclaration`; channel context remains normalized through each declaration's immutable video-to-channel relationship.
Authenticated viewers can report videos/comments and submit copyright/takedown requests. Admin has queues for reports, moderation cases, takedowns and appeals, plus audited warn/strike/suspend/unpublish/remove actions. Creator-facing history exposes notices, actions, appeals and trust state.
Moderation settings include blocked-term hooks and `newCreatorsRequireReview`, whose default is false. Trust levels are NEW, STANDARD, TRUSTED and RESTRICTED. Destructive state changes and trust/settings changes are audit logged.
No external legal notice processor or automated copyright matching service is represented as configured.
