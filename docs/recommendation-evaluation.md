# Recommendation evaluation and rollout

Task 66 adds a measurement gate before adding more recommendation complexity or AI.

## Current ranking being evaluated

AYIN currently uses an explainable heuristic ranking. Video recommendations combine channel history affinity, subscriptions, likes, completion affinity, popularity, recency and an optional related-channel boost. Safe fallback ranking uses popularity plus recency. Creator TV has a separate fixed heuristic. Task 66 does not replace these rankers.

Every served recommendation response now includes:

- `algorithm`: the ranking family.
- `recommendationVersion`: a deterministic ID derived from the algorithm ID and the effective ranking configuration.
- `exposureId`: an opaque ID for the served ranked list.

The server stores a `RecommendationExposure` row containing the version, surface, mode, ordered item IDs and bounded score contributions. It intentionally stores no profile, session, account, IP or precise-location identifiers.

Clients that emit recommendation analytics should attach both `recommendationExposureId` and `recommendationVersion` to `RECOMMENDATION_IMPRESSION`, `RECOMMENDATION_CLICK` and attributable playback events. This allows outcome analysis without putting a private profile identifier in the exposure table.

## Offline evaluation

`recommendation-evaluator.ts` evaluates a candidate version against fixed cases. A case defines a labelled candidate universe, outcomes, prior-seen items and recent recommendation history. The evaluator tracks:

- precision proxy at the evaluation cutoff;
- recall proxy against the labelled relevant set;
- watch-time relevance, normalized by item duration;
- completion rate;
- topic diversity;
- creator diversity;
- catalog diversity;
- novelty versus prior-seen items;
- repeated-item rate, including duplicate/currently repeated recommendations.

The fixture is fixed and deterministic. The same inputs must produce byte-for-byte equivalent metric objects across runs. Recommendation changes should add or update fixture rankings deliberately; do not generate random fixtures in CI.

## Release decision

A recommendation change is evaluated in this order:

1. Assign the candidate a stable algorithm/config version.
2. Run all recommendation unit tests and the fixed offline fixture.
3. Compare the candidate with the currently accepted baseline using `compareRecommendationVersions`.
4. Run `assessRecommendationRelease` guardrails.
5. Investigate every blocker instead of averaging it away with a single engagement score.
6. Only after offline gates pass should a later rollout process consider limited online experimentation.

The default guardrails allow small noise but block material regressions in relevance, completion, diversity, novelty or repeated-item rate. In particular, a candidate that improves watch time while collapsing creator/catalog diversity is rejected. Watch time is therefore not the exclusive objective.

## Production data extraction

Admin read-only endpoints under `/admin/recommendation-evaluation` provide:

- `/versions`: observed version/surface exposure counts;
- `/exposures`: redacted score-component debugging for one version;
- `/export`: privacy-safe exposure/outcome rows using `recommendationExposureId` attribution;
- `/fixed-fixture`: deterministic baseline/candidate fixture evaluation.

The production export intentionally does not invent recall. Recall requires a labelled relevant candidate set, including items that were not shown, so recall comparisons belong in the offline fixture unless a future experiment provides that ground truth.

## Score debugging and privacy

Exposure debugging records weighted score contributions such as subscription, history, likes, completion, popularity, recency and related-channel contribution. It does not store raw watch history counts or a profile identifier. Admins can explain why an item ranked highly without opening a private viewer profile.

## Future A/B boundary

`allocateRecommendationVariant` defines a deterministic allocation boundary using a stable non-PII allocation key, experiment key and explicit basis-point weights. Task 66 does **not** call this allocator in production and does not enable multi-variant experiments. A future experimentation task can use it after defining consent, assignment persistence, statistical power and rollback rules.

## Required checks before rollout

A recommendation PR should not be promoted until formatting, lint, typecheck, unit/schema tests, database migrations/integration tests, production build, security checks and browser acceptance are green on the exact final commit. If ranking logic changes, the PR should also document the baseline version, candidate version, fixture metric deltas and any guardrail exceptions with rationale.
