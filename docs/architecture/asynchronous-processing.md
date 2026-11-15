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

BullMQ defaults: four attempts, exponential backoff starting at 2 seconds, completed job retention up to one day/1000 jobs, failed up to seven days/5000 jobs. These can be set using `PHOTO_JOB_ATTEMPTS`, `PHOTO_JOB_BACKOFF_MS`; queue name defaults to `photo-processing`. Worker concurrency supports 1 or 2 in code; current overlays set 1.

Worker marks invalid images or missing originals as terminal failures, and transient errors return the photo to pending for retry. The server dispatcher retries failed outbox publication; it runs every two seconds, recovers processing records older than 15 minutes and pending records older than 10 minutes, and removes published outbox rows after seven days. Redis uses AOF and a PVC in Kubernetes; it is still a single Redis instance without replication. No independent outbox process or Redis failover is configured.

The worker exposes HTTP health on port 3001 (`/ready` returns readiness), but the inspected Deployment does not configure worker probes. Tests cover job behavior and outbox dispatch/recovery; live failure injection was not performed.
