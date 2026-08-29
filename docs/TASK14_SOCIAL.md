# Task 14 — Social graph baseline

Task 14 adds authenticated, profile-isolated, idempotent subscription, reaction, Watch Later, and distinct My List actions. Public likes expose only the LIKE count; DISLIKE is returned only as the current profile's private feedback state.

Subscriptions create at most one notification on the first successful insert. This avoids duplicate fan-out on repeated idempotent requests. The authenticated notification feed is account-scoped, paginated, and supports ownership-checked read state. Future large creator-publish fan-out should use an inbox-on-read or queued hybrid rather than synchronous per-subscriber inserts.
