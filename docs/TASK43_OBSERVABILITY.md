# AYIN Task 43 — Production observability

## Scope

AYIN now has a provider-neutral observability layer for the Web runtime, API, media worker and deployment runtime. It does not claim an external monitoring vendor is connected. The active adapter reports `provider=local` and `externalConnected=false` until a future release explicitly configures and validates an external exporter.

## Structured logging

API and media-worker Nest logs are emitted as one JSON object per line with:

- UTC timestamp
- severity
- service name
- release SHA
- event name
- request ID and correlation ID when a request context exists
- safe operational fields only

The Web server emits structured runtime start/request-error records through Next instrumentation. Successful health probes are intentionally omitted from API request logs to avoid probe spam. Worker idle polling is not logged.

Do not add request bodies or complete request headers to logs. The logger recursively redacts credential-shaped keys and scrubs bearer/JWT/token-like strings. Passwords, reset/session tokens, stream keys, API secrets and raw financial/KYC values are prohibited from logs even when debugging.

## Request tracing

The API accepts `x-request-id` and `x-correlation-id` only when they match the bounded safe identifier format. Invalid values are replaced with a generated UUID. Both IDs are echoed on responses and are included in structured request/error logs.

Recommended investigation flow:

1. capture `x-request-id` from the failing client response;
2. search JSON logs by `requestId` or `correlationId`;
3. confirm `releaseSha` on the same records;
4. compare the SHA with deployment proof and the exact Git commit;
5. inspect only the safe error class/code and relevant dependency state.

## Release diagnostics

- API: `/health`, `/health/live`, `/ready`, `/health/ready`
- Web: `/api/health`
- PM2 injects `AYIN_RELEASE_SHA` into Web, API and media-worker processes from the checked-out release.

A release SHA is diagnostic metadata, not a secret.

## Health semantics

### Liveness

`/health` and `/health/live` answer whether the API process is alive. They do not depend on the database.

### Readiness

`/ready` and `/health/ready` distinguish:

- database reachability and probe latency;
- critical configuration validity without returning secret values;
- media-worker state.

When media processing is enabled in production, the API expects the worker heartbeat file to be fresh. A missing/stale heartbeat makes production readiness fail. In non-production environments a missing worker is reported as `unknown` rather than blocking API tests/development.

The worker heartbeat contains only service/instance identity, release SHA, PID, timestamps, active-job count and lifecycle state.

## Operational metrics

Privileged operators can read `GET /admin/observability`. It intentionally exposes aggregates, not raw queue mutation controls or sensitive event payloads.

Key metrics:

- API requests in the rolling 60-second window and requests/sec;
- average, p50, p95 and max latency;
- HTTP status classes;
- media queue depth;
- oldest queued age;
- active media jobs;
- failed jobs;
- jobs that have retried;
- HTTP/media-upload/auth/ad error counters;
- `AD_ERROR` analytics count over the last 24 hours;
- active telemetry adapter status.

Counters local to the API process reset on restart/release. Durable queue and ad-error aggregates are read from the database.

## Alert candidates

Suggested initial alerts after a monitoring exporter is deliberately configured:

- API readiness not ready for 2 consecutive probes;
- DB probe failure or sustained DB probe latency > 1s;
- worker heartbeat age > 30s while media processing is enabled;
- queue depth continuously increasing for 10 minutes;
- oldest queued job > 10 minutes;
- failed media jobs increasing rapidly;
- retry count increasing without corresponding completions;
- 5xx rate > 2% for 5 minutes;
- p95 API latency > 1s for 5 minutes;
- auth failures increasing abruptly (rate alert only; never log credentials);
- upload/media errors increasing abruptly;
- `AD_ERROR` increase or ad-error ratio regression.

Thresholds are starting candidates and must be tuned against production baselines.

## Error classes

The provider-neutral classifier uses stable categories: `validation`, `authentication`, `authorization`, `not_found`, `conflict`, `rate_limit`, `configuration`, `database`, `storage`, `media`, `advertising`, `dependency`, and `internal`.

Do not create classifications containing user-supplied text or secret values.

## External provider status

Task 43 deliberately does not add a vendor SDK because the repository contains no configured monitoring-provider credentials or SDK. Operational hooks and the adapter contract are active locally. A later provider integration must preserve redaction, correlation IDs, release SHA, bounded payloads and the same health/metrics contracts before claiming external monitoring is connected.
