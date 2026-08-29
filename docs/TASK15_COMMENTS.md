# Task 15 — Comments and creator moderation controls

Implemented a bounded one-reply-level comment system with plain-text rendering, comment likes, creator heart/pin, own-comment edit window, soft deletion, reports, per-video comment enablement, channel-level hidden profiles, and creator/admin moderation hooks with audit records.

Abuse controls use per-account in-process rate limits plus database-configurable moderation settings (`commentMaxLength`, `commentBlockedTerms`, `commentEditWindowMinutes`) with safe defaults when unset. React renders comment bodies as text; HTML is never injected. The database migration adds comment-control and hidden-profile state with database foreign keys while keeping the Prisma feature model isolated.

TV UX intentionally keeps comments behind a secondary `<details>` surface so playback/focus remains primary.
