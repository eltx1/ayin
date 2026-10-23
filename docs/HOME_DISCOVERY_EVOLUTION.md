# AYIN home discovery: product direction and release contract

## Outcome

Home should help a viewer choose something worth watching, start it reliably, and return to it later. The design must work with a small genuine collection and grow with the platform. It must not depend on particular films, creators, countries, or two manually selected categories.

The ambition to outperform established video services is a product hypothesis, not a result demonstrated by this release. AYIN needs compelling inventory, reliable playback, understandable discovery, creator tools, and evidence from viewers. A larger hero or a longer list of shelves does not establish superiority.

## Diagnosis behind this change

At the audited baseline, `DiscoveryService.getHome` depended entirely on saved `HomeRowConfig` records. A valid response could contain `rows: []`; the viewer component rendered nothing for that case. The brand hero and account strip occupied the first screen even when real published videos were available through search and their watch pages.

Configured rows were assembled independently. A small catalogue could therefore repeat the same titles under several labels. The separate personalized ranker was not used by Home. Admin could edit existing sections but could not create the first one through the Home Builder.

An empty public response alone does not establish whether production configuration is missing, disabled, or excluded for a particular audience or region. Administrative access is needed to distinguish those states. This release does not seed production or reinterpret intentional disablement as missing setup.

## Viewer jobs and information order

| Viewer situation       | First useful outcome                          | Presentation rule                                                                             |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| First visit            | Recognize and start an eligible real title    | One actual spotlight with artwork, title, creator, duration when known, and Watch action      |
| Returning viewer       | Resume unfinished viewing                     | Real owned-profile progress retains its order and is not consumed by the spotlight            |
| Open-ended exploration | Compare distinct things to watch              | Format sections only when distinct inventory supports them; one mixed shelf for sparse supply |
| Specific intent        | Find a title, creator, or collection          | Existing search remains reachable; page section links lead to real rendered sections          |
| Kids viewing           | See only explicitly eligible content          | Existing authoritative Kids policy and safe destinations; no adult spotlight flash            |
| No eligible content    | Understand the state and choose a next action | A localized neutral state and search, never fabricated cards                                  |
| Failed read            | Recover without losing trust                  | A bounded read deadline and retry; no claim that the catalogue is empty                       |

The account controls remain available, but the account strip follows discovery. The brand fallback is compact. Content artwork is used without autoplay, new audio behavior, or a new media encoding path. Missing artwork has a neutral visual fallback while the real title and action remain usable.

## Configuration ownership

The existing typed platform setting `homeDiscoveryMode` has three choices:

| Stored choice | Saved section state                                   | Effective behavior                                     |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| INHERIT       | No rows at all                                        | Automatic catalogue composition                        |
| INHERIT       | Any row, including disabled or audience-excluded rows | Managed sections                                       |
| AUTO          | Any                                                   | Automatic composition; saved sections remain unchanged |
| MANAGED       | Any, including none                                   | Managed sections; no automatic replacement             |

This is a read-only resolution. Public reads do not initialize records, run the seed, recreate sections, or re-enable settings. In managed mode, independently configured editorial hero controls remain authoritative. In automatic mode, the eligible catalogue supplies the spotlight.

Creating the first section while INHERIT is selected changes the effective mode to MANAGED. The Admin creation review must explicitly explain and acknowledge that transition. Creating a section while AUTO is selected saves it for managed use and leaves automatic composition active. Settings retain their existing Operations permission, step-up, audit reason, and explicit high-impact confirmation.

Create Section uses a retained request UUID, a unique bounded key, a server-issued row revision, an atomic transaction, and an audit record. Repeating the same completed request returns the saved result; a changed payload, key collision, or stale revision is a conflict rather than another section. Existing sections are neither deleted nor rewritten as part of initialization.

## Automatic composition in this release

1. Resolve the current owned profile and trusted territory context.
2. Select at most 96 real, policy-eligible video IDs. Publication, public visibility, active channel, canonical validated media, territory, expiry, policy overrides, and Kids classification constrain eligibility **before** the bound.
3. Hydrate card fields in a batch and recheck current distribution policy at the serving boundary.
4. Preserve real Continue Watching when available. Select a separate eligible spotlight, preferring a long-form title with artwork.
5. Remove repeated video IDs across the initial resume row, spotlight, and shelves.
6. Prefer creators with fewer displayed items, then relax the preference when supply is sparse. A catalogue from one creator remains useful.
7. Create format shelves only when there are at least two substantial distinct pools. Otherwise show one useful mixed shelf. Do not create empty TV recommendations from automatically provisioned channel entities.
8. Return explicit `mode`, `status`, `spotlight`, and `rows` fields.

The finite selection contains at most five rows, with at most eight cards per row. It is an entry point to discovery, not exhaustive catalogue pagination. Its rows return `nextCursor: null`; existing managed row pagination is preserved. Search and catalogue destinations provide further exploration.

Automatic selection uses recency and composition rules. It does not claim to be personalized affinity ranking or popularity. There are no title IDs, creator IDs, film names, fake audience counts, or fixed countries in the compositor.

### Response states

- READY means actual eligible content exists in the spotlight or rows.
- EMPTY means the selected configuration has no eligible content for the current viewer.
- DISABLED is reserved for managed configuration with no enabled sections.

`UNAVAILABLE` on an existing row is not evidence of a service outage. It can indicate an anonymous personal source or an unsupported source. The UI does not transform it into a retry loop. Failed requests and deadlines remain explicit recoverable failures. A future partial-failure contract should distinguish operational errors from intentional ineligibility before introducing per-section retry claims.

The web boundary accepts the previous rows-only response during a rolling deployment, but validates supplied new fields, internal destinations, state consistency, and the existing Admin limit of 100 managed sections. Automatic headings are localized by mode and stable key; authored managed titles are preserved.

## Reliability and Arabic support

Private viewer state remains tied to the existing bootstrap and identity revisions. Suspension conceals content synchronously, and a new foreground session must obtain current policy before displaying it. Late row requests are aborted on unmount and cannot append after retirement. The same privacy boundary covers the new spotlight.

Arabic receives localized actions and automatic section headings, logical layout direction, safe fragment links, readable title line height, and mobile/keyboard focus handling. Public playlist route parameters are decoded once at the request boundary and validated before being encoded into API and retry URLs. Values returned by the database retain their existing raw-value encoding contract.

Actual Next browser validation also exposed a locale rewrite bug on loopback origins: NextURL's hostname normalization turned an internal rewrite into another HTTP request, losing the Arabic override or entering a cookie-driven redirect loop. Preserving the original request URL with the documented normalization option fixes those chains without trusting forwarded-host input or changing CSP. Document, RSC, prefetch, iframe, and trace-header behavior were checked separately.

The release does not weaken media policy, Admin authorization, advertising consent, or the video/IMA integration. Related caption transport and upload-processing feedback fixes are reviewed separately; a saved subtitle selection does not itself prove captions rendered.

## Validation and rollout

Required evidence is layered:

1. Pure composition and contract tests: zero/one/sparse/diverse inventory, mode ownership, no duplicates, diversity relaxation, bounds, malformed destinations, preserved editorial titles.
2. API integration against disposable Postgres: eligibility before pagination, more than 100 newer blocked titles, trusted and unknown territory, Kids, owned resume data, no configuration/snapshot writes from AUTO reads.
3. Actual Next browser checks: English and Arabic, narrow/mobile and desktop layout, working actions, empty/disabled/error/recovery states, section anchors, and synchronous concealment on suspension.
4. Repository formatting, lint, type checks, production builds, security checks, and deployment workflow gates.
5. Production verification of the deployed revision: public and signed-in home responses, rendered cards, watch navigation, actual playback, Arabic playlist navigation, and caption display where relevant.

A local build or a successful GitHub commit is not production completion. If the live configuration is intentionally managed and empty, inspect it through an authorized Admin session and select the desired mode explicitly. Do not bypass access controls or replace operator choices merely to make a screenshot look populated.

Rollback is configuration-aware: preserve stored rows throughout the release; explicitly choose MANAGED when returning to editorial layout. Reverting code can restore the prior no-row behavior and should not be confused with a content migration. This change has no schema migration or media-object rewrite.

## What follows, with separate evidence gates

### 1. Measurement and catalogue quality

Use existing consent and analytics boundaries to connect home exposure, selection, and successful playback. Define the event contract before collecting new data. Measure time from a usable home to first decoded content frame, qualified viewing using the platform's existing definition, failed starts, repeat exposure, distinct creators, useful search outcomes, and return visits. Track sample size and device/locale differences.

Proposed release guardrails are zero known policy-ineligible exposures, zero stale-profile exposures in regression tests, and no blank AUTO home when eligible inventory exists. Performance targets must be established with measured production baselines and a controlled load test; this work does not claim an unmeasured speed improvement.

Content intake should continue to prefer complete meaningful works with exact provenance, useful descriptions, real artwork, correct language/runtime/classification, and verified playback. Two cleared films demonstrate the path; they do not constitute a complete launch library.

### 2. Personalized ranking after correcting known gaps

Before putting the existing recommendation service on Home, fix its distribution/Kids policy filtering after the newest-160 cutoff, missing trusted-country context, negative reactions counted in a positive popularity term, and ignored DISMISSED feedback. Basic publication and playable-media eligibility already constrain that pool. Missing country currently fails closed for restricted videos; the observed risk is losing eligible recommendations, not proof of exposing restricted content. Then evaluate candidate recall, diversity, repeat exposure, and clear explanation codes. Preserve intentional resume behavior.

Start with a deterministic baseline and controlled evaluation. Additional ranking complexity is justified by measured viewer outcomes, not by the presence of an AI label. Provide meaningful negative feedback and history controls before optimizing solely for more viewing time.

### 3. Serving performance at larger scale

Move trending aggregation out of public request handling into the existing bounded worker architecture. Serve candidate IDs and scores from versioned snapshots, then apply current availability and policy. Do not share finalized personalized or territory-dependent responses using a URL-only cache.

Add diagnostics for effective mode, selected and suppressed sections, eligible candidate count, deduplication, fallback reason, stage latency, and snapshot age. Explain empty output without exposing private viewer data. Measure query plans and tail latency before expanding candidate pools or adding infrastructure.

### 4. Editorial depth and discovery evaluation

Extend managed curation with safe previews and revision-aware workflows as evidence justifies them. Test genre, theme, language, and creator collections with real supply; do not expose categories that cannot lead to useful content. Evaluate Arabic search relevance and subtitle availability as part of a complete viewing journey.

Netflix documents that recommendation presentation includes which rows appear, which titles enter them, and their order. YouTube describes satisfaction signals beyond clicks alone. These are useful principles, not evidence that copying either interface will produce the same outcome:

- [Netflix: How our recommendations system works](https://help.netflix.com/en/node/100639)
- [YouTube: On YouTube's recommendation system](https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/)

AYIN's next decisions should follow its own catalogue, viewers, and measured failure modes.
