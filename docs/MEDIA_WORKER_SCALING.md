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

## Automatic local scratch cleanup

Every media-worker attempt uses its own private directory under
`MEDIA_PROCESSING_WORKDIR` (default `/tmp/ayin-media-processing`). The executor
removes the source before adaptive packaging when possible and removes the entire
attempt directory when processing settles, including failure paths. This does not
wait for the creator to publish. Required playback objects and thumbnails stay on
R2; database metadata and diagnostic logs are not local video copies.

The worker also checks for retained local scratch at startup and every five minutes,
without changing processing concurrency. A failed immediate removal is logged as
`media_scratch.cleanup_failed` with a sanitized error code, then retried. Scans are
limited to 256 entries per tick and retain their iterator so skipped entries cannot
starve later directories. Summaries report counts without private object keys.

After all local media processes have finished, the executor durably seals the
ownership record **before** committing READY. Retried deletion of these completed
attempts does not depend on inspecting unrelated system processes, even after a
worker restart; an active database lease still prevents the sweep. Failure to save
the seal prevents READY and requeues the job instead.

For unsealed interrupted attempts, crash recovery is conservative: only directories created with the new durable owner
marker qualify. On Linux it verifies the same host, boot identity, process start
identity, an inactive database job without a lease, and the absence of same-user
processes referencing the directory via arguments, working directory or open file
descriptors. This also protects orphan ffmpeg children after a worker is killed. A host that denies inspection of same-user processes retains these unsealed crash attempts with a visible warning; it does not guess from process names.
An active attempt remains protected even after READY is committed. Symlinks,
unknown directories, inaccessible process evidence, database failures and another
host's markers are retained rather than guessed safe. `media_scratch.retry_deferred`
and `media_scratch.sweep_failed` expose inspection errors for operations review.

Keep the work root on local Linux storage with `/proc` visible to the media-worker
OS account. Non-Linux workers retain immediate cleanup but do not perform crash
sweeps. Legacy/unmarked directories require separate investigation; a crash before
the ownership marker is persisted can leave an empty directory, but the executor
does not download media until marker creation has succeeded. No broad cron deletion
of `/tmp`, release trees, or unrelated applications is used.
