# AYIN Task 46 — Capacity baseline

Task 46 adds a guarded, repeatable load harness for local and staging infrastructure. It does **not** run against production, create a new service, or claim an unmeasured capacity number.

## Safety boundary

The runner refuses to start unless `AYIN_CAPACITY_ENVIRONMENT` is exactly `local` or `staging`. Production AYIN hosts, their subdomains, and the current production IP are hard-blocked. Local runs accept loopback targets only. Staging requires an exact API and database hostname allow-list plus the literal `RUN_SAFE_CAPACITY_TEST` confirmation. `stress` and `soak` require a second literal confirmation.

The GitHub workflow is manual only, serializes capacity runs, and uses the protected `capacity-staging` environment. Configure required reviewers on that environment before enabling it. There is intentionally no schedule: baseline tests consume capacity and should run after meaningful code/infrastructure changes, not continuously.

Secrets are read only from environment variables. They are never included in reports or console summaries. Use a dedicated synthetic account and channel with no real user data.

## Scenarios and expected responses

| Scenario                     | Path                                                      | Default behavior                                  | Expected status            |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------- | -------------------------- |
| Public catalog reads         | `GET /public/discovery/home`                              | Weighted read load                                | 2xx JSON object            |
| Watch metadata               | `GET /public/videos/:slug/playback`                       | Included only with a known safe slug              | 2xx JSON object            |
| Search                       | `GET /public/search?q=...`                                | Weighted read load                                | 2xx JSON object            |
| Registration validation      | `POST /auth/register` with deliberately invalid input     | At most 1–5 attempts; never creates an account    | 400                        |
| Analytics batch ingestion    | `POST /analytics/events` with ten tagged synthetic events | Opt-in, bounded, deleted by run ID afterward      | 200/201                    |
| Login                        | `POST /auth/login`                                        | Credential-gated, at most five iterations         | 200 with ephemeral token   |
| Upload-session authorization | Log in, create 1 KiB authorization, then abort it         | Opt-in, at most five iterations; no object upload | 2xx for all three requests |
| Media queue                  | Database observation only                                 | Separate queue mode; harness never enqueues media | N/A                        |

Read-only scenarios are the sustained workload. Login runs only when dedicated credentials are configured. Mutating analytics and upload-session scenarios additionally require `AYIN_CAPACITY_ENABLE_MUTATIONS=1`, a cleanup database URL, and small hard caps. Analytics events carry a random `capacityRunId`; pending/rejected upload assets are tracked by UUID. Cleanup deletes only those exact synthetic records. Login bearer tokens stay in memory and are never printed or persisted. A cleanup failure makes the command fail and must be resolved before another mutating run.

## Profiles

| Profile  | Duration ceiling | Target iterations/s | Concurrency | Iteration budget | Purpose                                          |
| -------- | ---------------: | ------------------: | ----------: | ---------------: | ------------------------------------------------ |
| `smoke`  |             10 s |                   2 |           2 |               20 | Validate target, fixtures, metrics and cleanup   |
| `normal` |             60 s |                  10 |          10 |              600 | Repeatable expected-load baseline                |
| `peak`   |            120 s |                  25 |          25 |            3,000 | Expected burst envelope                          |
| `stress` |            180 s |                  50 |          50 |            9,000 | Find the first violated service objective safely |
| `soak`   |           30 min |                  10 |          10 |           18,000 | Detect resource/queue drift                      |

These are test inputs, **not measured AYIN capacity**. Progress only one profile at a time. A rolling 10% error rate after at least 50 completed iterations stops an HTTP run early. Operator monitoring and the protected GitHub environment remain authoritative emergency stops for CPU, memory, database saturation or queue growth.

## Metrics

Every JSON report records run ID, environment, target origin, profile, elapsed time, stop reason and release SHA when `GITHUB_SHA` or `RELEASE_SHA` exists. HTTP totals and every scenario include:

- logical iterations/s and actual network requests/s;
- p50, p95, p99 and maximum latency using nearest-rank percentiles;
- error count/rate and stable failure classification.

With `AYIN_CAPACITY_DATABASE_URL`, the runner samples PostgreSQL connection utilization, active connections, transactions/s, buffer cache hit rate, temporary bytes and deadlock deltas. It also samples media queue depth, growth, completed/failed job deltas and worker throughput. With local Linux `AYIN_CAPACITY_TARGET_PIDS=api:1234,worker:5678`, it records peak RSS and process CPU. A metric that is not configured or sampled is reported as such, never filled with an estimate.

Queue mode measures pre-seeded synthetic media jobs separately from API load. Use a dedicated staging/local database with no user workload, pre-seed only approved small fixture media through the existing test tooling, then run:

```bash
AYIN_CAPACITY_ENVIRONMENT=local \
AYIN_CAPACITY_API_URL=http://127.0.0.1:4000 \
AYIN_CAPACITY_DATABASE_URL=postgresql://ayin:secret@127.0.0.1:5432/ayin_test \
AYIN_CAPACITY_MODE=queue \
AYIN_CAPACITY_QUEUE_CONFIRMATION=OBSERVE_SYNTHETIC_QUEUE \
pnpm capacity:run
```

## Safe procedure

1. Reserve a local/staging window and confirm no production DNS, database tunnel or user data is present.
2. Record the candidate release SHA and infrastructure shape. Create the dedicated synthetic identity/channel and a small published watch fixture.
3. Run `smoke` read-only. Verify every expected status, report completeness and stable infrastructure graphs.
4. Enable bounded mutations only after confirming database cleanup access. Verify cleanup says `completed`.
5. Run `normal` three times. Preserve all reports; use medians of the three runs as the initial baseline.
6. Run `peak` only if normal satisfies the acceptance criteria below. Run `stress` to locate a boundary, not as a pass/fail gate. Run `soak` only in a reserved window.
7. Stop immediately on sustained errors, DB connection utilization at or above 80%, CPU at or above 85%, memory pressure/swapping, queue growth without completions, or impact outside the synthetic environment.

Example read-only local run:

```bash
AYIN_CAPACITY_ENVIRONMENT=local \
AYIN_CAPACITY_API_URL=http://127.0.0.1:4000 \
AYIN_CAPACITY_PROFILE=smoke \
AYIN_CAPACITY_WATCH_SLUG=capacity-fixture \
AYIN_CAPACITY_TARGET_PIDS=api:1234,worker:5678 \
pnpm capacity:run
```

Never put secret values on the command line in shared shells or CI logs; prefer protected environment secrets.

## Baseline status and evidence

No staging/local capacity target or dedicated credentials are configured in this repository, so Task 46 did not execute a load profile and records **no RPS capacity claim**. The first executable baseline is pending the safe procedure above.

Current evidence establishes constraints, not capacity:

- deployment is a modular monolith with one web process, one API process and one media-worker process;
- login is limited to 12 attempts per five minutes per IP/scope outside tests;
- upload-session creation is limited to 12 attempts per minute per account outside tests;
- Task 43 identifies p95 API latency above 1 second for five minutes, 5xx above 2% for five minutes, and continuously growing/old queues as initial alert candidates;
- adaptive backfill already limits in-flight work and gives creator uploads priority.

Likely bottlenecks to verify are the single API process, database connection/query pressure on catalog/search, authentication hashing, R2 authorization latency, and CPU/scratch pressure in the single media worker. These are hypotheses until reports demonstrate them.

## Evidence-based limits and scaling trigger

A profile is acceptable only when all three repeated runs meet the agreed service objective, cleanup completes, error rate stays below 1%, no deadlocks occur, DB connection utilization stays below 70%, CPU stays below 70%, memory does not trend upward, and the media queue returns to its starting depth. Until three normal and one peak report meet those conditions, retain existing rate limiters and make no public capacity promise.

After measurement, define the recommended operating limit as 70% of the highest **measured** sustained request rate whose three runs meet every acceptance criterion. Store report artifact IDs and release SHA beside that decision. Scale the existing modular deployment when either:

- observed 15-minute demand exceeds 70% of that measured limit twice in seven days;
- p95 latency doubles from the measured normal baseline for 15 minutes;
- API CPU or DB connection utilization exceeds 70% for 15 minutes at otherwise healthy error rates;
- queue depth grows across two worker service-time windows or oldest queued age exceeds Task 43's 10-minute candidate.

First responses are query/index investigation, vertical resources, safe API process scaling, and worker concurrency tuning within existing lease/FFmpeg/R2 bounds. A separate microservice is not justified by Task 46.
