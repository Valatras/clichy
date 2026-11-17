# Asynchronous photo processing

## Lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant API as Fastify API
  participant DB as PostgreSQL
  participant D as Outbox dispatcher (in API)
  participant R as Redis / BullMQ
  participant W as Worker
  participant FS as Photo filesystem
  U->>API: POST /photos (multipart)
  API->>API: Validate image and persist original
  API->>DB: Transaction: photo row + outbox row
  API-->>U: 202 Accepted, PENDING
  D->>DB: Read unpublished outbox batch
  D->>R: Add process-photo with stable job ID
  D->>DB: Mark event published (or retain error)
  R->>W: Deliver job
  W->>DB: Atomically claim PENDING/FAILED photo
  W->>FS: Read original; write derivatives
  W->>DB: Store EXIF, dimensions, hashes, COMPLETED
```

The outbox reduces the chance that a database photo row is committed while its queue event is lost. Dispatcher logic is in `apps/server/src/queues/outbox-dispatcher.ts`; upload transaction is wired in `apps/server/src/routes/photos.ts`. A stable SHA-256-derived job ID makes repeated publication idempotent at the queue identity level.

The original file is written before the database transaction. If the API process stops after the filesystem write but before the transaction commits, there is no photo row or outbox event to recover, and the repository has no orphan-file sweeper. When database registration returns an error, the route attempts to delete the original and logs cleanup failures, but that cleanup is best-effort.

BullMQ defaults: four attempts, exponential backoff starting at 2 seconds, completed job retention up to one day/1000 jobs, failed up to seven days/5000 jobs. These can be set using `PHOTO_JOB_ATTEMPTS`, `PHOTO_JOB_BACKOFF_MS`; queue name defaults to `photo-processing`. Worker concurrency supports 1 or 2 in code; current overlays set 1.

Worker marks invalid images or missing originals as terminal failures, and transient errors return the photo to pending for retry. The server dispatcher retries failed outbox publication; it runs every two seconds, recovers processing records older than 15 minutes and pending records older than 10 minutes, and removes published outbox rows after seven days. If the worker is killed abruptly, the photo stays `PROCESSING` until stale-processing recovery runs; allow at least 15 minutes before expecting the outbox to republish it. A normal SIGTERM instead lets BullMQ close gracefully and finish its active job within Kubernetes' 120-second termination grace period.

The worker exposes HTTP health on port 3001. The Deployment configures a liveness probe on `/live` and a readiness probe on `/ready`; readiness also requires the Redis connection to be ready. After BullMQ exhausts its retries, or finds an invalid image or missing original, the photo remains `FAILED`; there is no per-photo retry action in the UI. The operator can run the backfill script to reschedule incomplete photos, but it scans the whole library.

Tests cover derivative creation, permanent and transient failures, a duplicate delivery losing the database claim, outbox publication failure, the enqueue/ack crash window, and stale-processing recovery. Live worker interruption and recovery still need to be demonstrated in Test.
