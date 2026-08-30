# Recommendations V1 and AYIN Lens

AYIN Recommendations V1 is deliberately an explainable, rule-based ranking layer. It is not marketed as machine learning. The service contract exposes home, up-next, related, Clips and Creator TV recommendation methods so a later model-backed implementation can replace the scorer without changing consumer APIs.

## Signals and ranking

The V1 scorer uses only first-party AYIN data already collected for product behavior: recent watch history, subscriptions, likes, channel completion affinity, recency and aggregate popularity. Hidden, suspended, removed, private, unplayable and explicitly `NOT_INTERESTED` videos are excluded before ranking. Admin-configurable weights live in the platform settings catalog. When personalization is disabled or a profile has no usable signals, ranking falls back deterministically to recency and observed popularity.

The current schema does not attach taxonomy/category entities directly to videos, so category affinity is intentionally not fabricated. A future taxonomy relation can become another scorer input behind the existing recommendation contract.

## AYIN Lens explainability

Each recommendation carries a machine-readable reason code and user-facing explanation such as `From a channel you follow`, `Because you watch this creator`, or `Popular and recent on AYIN`. The `/my-ayin/lens` surface displays those reasons and lets the viewer mark a video as not interested or reset personalization. Resetting creates a profile reset timestamp; signals older than that point are ignored rather than deleting watch history that may be required for other product features.

Analytics events cover recommendation impressions/clicks and Lens open/dismiss/not-interested actions.

## Semantic search boundary

AYIN Lens search has a provider-neutral `AyinLensSearchProvider` interface. The repository ships an unconfigured provider and keeps semantic search disabled by default. When no real embedding/search provider is configured, Lens returns the existing local lexical search result and reports `LEXICAL_FALLBACK`. This prevents private viewing/search data from being sent to an external provider by accident and prevents the product from claiming semantic/AI search when none exists.

A production provider must explicitly implement the interface, declare itself configured, document what data leaves AYIN, and be enabled through the Admin platform setting only after privacy/security review.

## Operational controls

Admins can disable personalized recommendations globally, tune V1 weights, and disable semantic Lens search. Turning personalization off is the emergency deterministic fallback; it does not make content that fails normal visibility/moderation checks eligible.
