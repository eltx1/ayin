# AYIN Task 45 — External synthetic monitoring

## Scope and safety

Task 45 adds an external, deployment-independent production checker. It uses only bounded anonymous `GET` and `HEAD` requests. It does not log in, publish, update, or delete content and never sends watch-progress or analytics mutations.

The checker does not inspect or print environment variables, request headers, signed URLs, cookies, tokens, or response bodies. Optional asset URLs must be credential-free public HTTPS objects on `media.ayin.stream`; query strings are rejected so signed credentials cannot enter reports. Authentication monitoring is intentionally outside this task. If added later, it must use a dedicated synthetic identity and GitHub Environment secrets that are never printed.

## Schedule and confirmation

GitHub Actions runs `Production synthetic monitoring` every 15 minutes and on manual dispatch. Fifteen minutes is frequent enough to detect user-visible outages without creating unnecessary production traffic.

Every request has:

- a 20-second timeout;
- at most two attempts with bounded backoff;
- schema/content validation, not status-only checks;
- a per-path latency budget;
- structured latency, failure-classification and release-SHA recording.

Checks run concurrently. A failed check is run through a second confirmation pass after 30 seconds. Only a check that still fails is a confirmed failure. A successful confirmation is recorded as `recovered` and does not fail the workflow or invoke the alert adapter.

## Check contract

| Check            | Expected result                                                | Latency budget | Severity |
| ---------------- | -------------------------------------------------------------- | -------------: | -------- |
| Homepage         | `200`, usable HTML containing AYIN identity                    |           15 s | Critical |
| Web health       | `200`, `ayin-web`, `alive`, valid release SHA                  |           12 s | Critical |
| API health       | `200`, `ayin-api`, `alive`, valid release SHA                  |           12 s | Critical |
| API readiness    | `200`, ready; database, configuration and worker all `ok`      |           12 s | Critical |
| Public discovery | `200` JSON with a `rows` array; an empty catalog is valid      |           15 s | Major    |
| Search baseline  | `200` JSON with normalized query, items and cursor contract    |           15 s | Major    |
| `robots.txt`     | `200` text with user-agent rules and AYIN sitemap              |           15 s | Minor    |
| `sitemap.xml`    | `200` XML sitemap index/urlset containing AYIN URLs            |           15 s | Major    |
| Watch page       | `200` usable HTML for dedicated safe public content            |           15 s | Critical |
| Playback API     | `200` playable public video contract with MP4 fallback         |           15 s | Critical |
| Media HEAD       | `200/206`, video type, non-empty length and byte-range support |           12 s | Major    |
| Media range      | `206`, valid `Content-Range`, non-empty bounded bytes          |           12 s | Critical |
| Thumbnail        | `200`, image type and non-empty length                         |           12 s | Major    |

All active checks record every attempt's latency. API/Web responses also record a valid `x-ayin-release` or JSON `releaseSha` when available.

### Safe-content configuration

Production currently has no repository-owned public synthetic video. The catalog checker therefore treats zero rows honestly and never creates content. Set these GitHub **repository variables** only after Operations publishes and protects a dedicated public synthetic asset:

- `AYIN_SYNTHETIC_WATCH_SLUG`
- `AYIN_SYNTHETIC_MEDIA_OBJECT_URL`
- `AYIN_SYNTHETIC_THUMBNAIL_URL`

Until set, those checks are explicitly `skipped`, not reported as passing. URLs must be public, stable objects below `https://media.ayin.stream/`, without credentials or query strings. Do not point routine checks at user-owned content that may legitimately be removed.

## Failure classes

Stable classes are `timeout`, `dns`, `tls`, `network`, `http_4xx`, `http_5xx`, `http_status`, `response_validation`, `response_size`, `latency`, and `configuration`. Raw network errors and response bodies are not included in output.

## Alert adapter

`NullAlertAdapter` is the truthful default: `{ attempted: false, delivered: false, provider: "none" }`. No email, Slack or webhook provider is configured or claimed in Task 45. Confirmed failures still fail the GitHub Actions run and remain visible in its summary/artifact.

A future provider implements the narrow `notify(payload)` adapter and returns its actual attempted/delivered state. Payloads contain only check IDs, severity, classifications, bounded messages, attempt latency/status metadata and timestamps. Provider credentials must come from GitHub Environment secrets and must never be copied into payloads or output.

## Maintenance suppression

Before planned production maintenance, set repository variable `AYIN_SYNTHETIC_MAINTENANCE_UNTIL` to an ISO-8601 UTC expiry, for example `2026-09-08T03:30:00Z`. Checks continue and reports remain available, but confirmed failures become `maintenance_suppressed`, do not invoke the alert adapter and do not fail the workflow. Remove the variable after maintenance. An expired timestamp never suppresses failures, preventing an indefinite mute.

## Escalation

1. **Critical confirmed failure:** acknowledge immediately; compare recorded Web/API release SHAs; inspect Task 43 request/correlation logs and the latest deployment proof. Roll back only through the established production release workflow when the current release caused the failure.
2. **Major confirmed failure:** investigate within 30 minutes. Check whether the failure is edge, catalog/database, media, or schema related before changing production.
3. **Minor confirmed failure:** investigate during the same operational day unless accompanied by a major/critical failure.
4. **Repeated latency failure:** compare at least four consecutive 15-minute reports before tuning a threshold. Do not raise budgets merely to hide a regression.
5. If GitHub Actions itself is unavailable, use the same CLI from an independent trusted scheduler; do not add a second deployment process or mutate production to prove availability.

## Local validation

```bash
corepack pnpm --filter @ayin/synthetic-monitoring test
node packages/synthetic-monitoring/src/cli.mjs --report=synthetic-report.json
```

The second command performs real production reads. Keep optional safe-content variables unset unless their targets meet the contract above.
