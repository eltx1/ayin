# Media Worker Horizontal Scaling

Task 85 keeps AYIN's media-processing queue on PostgreSQL and makes it safe to run more than one media worker process or host. Redis, Kafka and another queue service are not required.

## Ownership model

Each media worker process registers a stable worker identity in `MediaProcessingWorker`. The registry stores:

- host name and process id;
- detected CPU capacity;
- configured per-worker concurrency;
- active job count;
- supported media processing architecture version;
- release SHA;
- startup, heartbeat, draining and stopped timestamps.

The registry is operational metadata only. Job ownership is enforced by PostgreSQL leases.

Every claim creates a **unique claim token** in `MediaProcessingJob.leaseOwner` and stores the stable process identity separately in `leaseWorkerId`. The claim token is the fencing token used by job heartbeats, stage changes, adaptive state changes, retries and finalization.

This distinction matters when a lease expires and the same process later reclaims the same job: an execution using the old claim token cannot write through the newer claim.

## Atomic claims and global concurrency

Claims remain PostgreSQL-backed. A short transaction-scoped PostgreSQL advisory lock serializes the global capacity check, stale-lease recovery and claim transition. Within that transaction a queued job is conditionally moved to `PROCESSING` only when it is still unowned.

The existing platform setting `mediaProcessingConcurrentJobs` is the **global database-wide cap** across all worker processes and hosts.

`MEDIA_WORKER_CONCURRENCY` is an additional **per-process cap**:

- default: 1;
- minimum: 1;
- maximum: 128.

The effective local slot count is the lower of the per-worker limit and the current global platform cap. Raising local concurrency never bypasses the PostgreSQL global cap.

## Lease and heartbeat rules

Active statuses are `PROCESSING`, `UPLOADING` and `VERIFYING`.

A valid owner must match the exact claim token **and** have an unexpired `leaseExpiresAt`. Task 85 applies that rule to:

- job heartbeat extension;
- stage/progress changes;
- retry/failure transitions;
- canonical READY finalization;
- adaptive/HLS state mutations.

Job heartbeats run every 10 seconds. The platform lease setting is already constrained to at least 30 seconds, leaving multiple heartbeat opportunities before expiry.

If a worker crashes or loses database connectivity long enough for the lease to expire, another claimant transaction first recovers the stale lease. The job is either requeued or marked failed when its retry limit has been exhausted. The old claim token is permanently fenced from the recovered job.

## Exactly-one finalization and idempotent output

Canonical and adaptive object keys are deterministic for the video/generation. Existing verified canonical output is reused instead of blindly retranscoded. Local scratch directories are additionally namespaced by a hash of the unique claim token, so an expired execution and its reclaimed successor cannot corrupt each other's temporary files even on the same host.

READY finalization uses:

- the live fenced lease;
- the deterministic output object key;
- a database upsert for the canonical media asset;
- a conditional READY transition that must affect exactly one actively owned job row.

If finalization races with lease recovery or another finalization attempt, the losing transaction rolls back. Concurrent integration tests verify one READY transition and one final asset.

Adaptive lifecycle mutations already use the same live-lease fencing and transaction-level ownership checks.

## Graceful shutdown

On SIGTERM/SIGINT the media worker:

1. stops claiming new jobs;
2. marks its registry row `DRAINING`;
3. continues active work for `MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS`;
4. if jobs remain after the grace window, aborts bounded FFmpeg/FFprobe/HLS subprocess work;
5. the executor stops extending the job heartbeat and, while its lease is still live, requeues the aborted job with `MEDIA_WORKER_SHUTDOWN`;
6. if an external transfer cannot stop immediately, the process no longer renews the lease, so PostgreSQL lease expiry/recovery is the final safety mechanism;
7. the worker registry is marked `STOPPED`.

The grace value defaults to 60 seconds and is clamped to 5-300 seconds. PM2 allows enough termination time for the maximum configured drain plus abort cleanup.

A worker must never clear or hand a lease to another worker while its old execution is still authorized to write. Fencing and lease expiry are preferred over an unsafe eager release.

## Scaling on one host

The repository's default PM2 topology runs one `ayin-media-worker` process. To add another process on the same host, run another instance pointed at the same:

- PostgreSQL database;
- R2 bucket/configuration;
- application release/schema version.

Give each process its own process identity automatically; no manually assigned worker id is required. Keep `MEDIA_PROCESSING_WORKDIR` on storage with enough scratch capacity for the number of local concurrent jobs.

Before increasing process count, raise `mediaProcessingConcurrentJobs` only to a value the host CPU, memory, disk scratch and R2 bandwidth can sustain. Use `MEDIA_WORKER_CONCURRENCY` to keep an individual process below that global ceiling.

The legacy local heartbeat JSON file is only a host-local liveness aid. `MediaProcessingWorker` in PostgreSQL is the authoritative multi-process/multi-host worker registry.

## Scaling to another host

A second host is safe only when both hosts use the **same PostgreSQL queue database** and the same media object store.

The current zero-budget launch topology binds PostgreSQL to loopback on the application host. Therefore adding a remote media host requires first making that PostgreSQL database reachable through a private, authenticated network path or moving it to an appropriate shared PostgreSQL deployment. Do not expose PostgreSQL publicly.

After shared PostgreSQL connectivity exists:

1. deploy the exact same AYIN release/schema version to the worker host;
2. configure the same R2 media storage credentials with least privilege;
3. configure a host-local scratch directory;
4. set `MEDIA_WORKER_CONCURRENCY` for that host's CPU/memory capacity;
5. start `dist/media-worker.js`;
6. confirm its `MediaProcessingWorker` heartbeat and processing version in the Admin media-processing overview;
7. raise the global `mediaProcessingConcurrentJobs` cap only after observing capacity.

No Redis/Kafka migration is implied by adding hosts. PostgreSQL remains the queue source of truth until measured contention or throughput provides evidence that another queue is operationally necessary.

## Failure drills

Before relying on horizontal capacity, verify these cases in staging or controlled production:

- start two workers and confirm one job receives one active claim token;
- kill a worker during processing and confirm the lease expires and the job is reclaimed;
- restart the killed worker and confirm its old token cannot mutate the reclaimed job;
- terminate a worker gracefully and confirm it stops claiming before draining;
- race finalization and verify one READY job/final asset;
- confirm deterministic R2 outputs are reused after retry;
- confirm workers running different processing versions are visible in the registry before allowing mixed-version processing.

Task 85 CI includes concurrent PostgreSQL tests for duplicate-claim prevention, expired-lease fencing, crash recovery and exactly-one finalization.
