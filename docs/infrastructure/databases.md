# PostgreSQL, Citus and CloudNativePG

**What is it?** PostgreSQL stores relational data; Citus adds logical hash shards.
CloudNativePG (CNPG) manages the PostgreSQL primary, standby and role Services.

**Why Clichy uses it** Test and Production target the same schema and topology:
32 photo/outbox shards inside one writable PostgreSQL instance, physically
replicated to a standby. This combines sharding and replication without worker groups.

## Architecture and rollout status

```mermaid
flowchart LR
  classDef default fill:#f4f6f8,stroke:#8b98a5,color:#273746
  API[API / worker] --> RW[clichy-postgres-rw]
  RW --> P[Primary]
  P -->|WAL asynchronous| S[Standby]
  classDef database fill:#edf5ef,stroke:#72977d,color:#203a29
  class P,S database
```

The primary accepts writes; the standby replays its WAL (write-ahead log).
This is the **CNPG + Citus target**, not the current `master` integration:
its CNPG manifest still uses plain PostgreSQL, and the custom Citus image and
unification migration described below are absent from this branch. Cutover
must not be assumed complete.
The operator's 2026-11-17 read-only output confirmed:

| Source | Observed state before cutover |
| --- | --- |
| Active Test | Standalone PostgreSQL 18.4/Citus 14.2; correct 32 colocated shards; zero users/photos/outbox rows |
| Existing Test CNPG | PostgreSQL 18.6, two streaming instances; a different database with one user/photo/outbox row and three migrations |
| Production | PostgreSQL 18.6, two streaming CNPG instances; no Citus; zero users/photos/outbox rows; single-column primary keys |

These databases are **not interchangeable**. Test import must preserve the old
CNPG database separately, including its migration history; never merge or overwrite
it based on the active Citus database's empty row count. The
[controlled procedure](../operations/deployment.md#controlled-cutover) is mandatory.

## Citus: logical sharding

**What is it?** Citus routes rows by a distribution key. Colocation aligns the
shard layout of related tables; reference tables support shared identity data.

**Why Clichy uses it** `Photo` and `PhotoProcessingOutbox` belong to users and can
share `userId` routing and foreign-key enforcement in both environments.

```mermaid
flowchart TB
  classDef default fill:#f4f6f8,stroke:#8b98a5,color:#273746
  A["Alice: photos A1, A2"] -->|userId| H["hash(userId)"]
  B["Bob: photo B1"] -->|userId| H
  C["Chloé: photo C1"] -->|userId| H
  subgraph PG["One writable PostgreSQL instance — 32 logical shards per table"]
    S1["Shard α: A1, A2, C1"]
    S2["Shard β: B1"]
    Rest["30 other shards"]
  end
  H --> S1
  H --> S2
  classDef shard fill:#eef3fa,stroke:#8297b5,color:#24364d
  class S1,S2,Rest shard
```

Illustrative hash results: one user's photo rows stay together; several users
can share a shard. Matching outbox rows use colocated shards. These are **32
logical partitions per table, not 32 servers**; image bytes stay on the photos
PVC. Active Test's standalone Citus uses this local layout; CNPG + Citus remains
the target integration. A standby copies the data rather than splitting it.

Each table uses `hash(userId)`, 32 shards and the same positive colocation ID.
`user` is a reference table (`n/t`, one shard). Compound primary/unique keys
include `userId`. Outbox references `Photo(userId,id)`; Photo-to-user delete is
RESTRICT, outbox-to-photo delete is CASCADE, and both FK updates are RESTRICT.
Images remain on the existing shared photos PVC. Existing coordinator-local
auth-table registrations can remain in Test; they are not hash shards and are
not converted or discarded.

Only the local coordinator (`localhost:5432`, group 0) stores shards. WAL copies
its catalogs and physical shard tables together. After promotion localhost means
the promoted instance, so no external worker addresses need rewriting. Application
connections use `clichy-postgres-rw`; do not point them at individual Pods.

## Image, initialization and Prisma

The Dockerfile under `infra/kubernetes/cnpg` pins the CNPG PostgreSQL 18.6 image
and official Citus 14.2 image by digest, on Debian 13/PG18. It copies extension
files rather than PostgreSQL executables, installs pinned libcurl and verifies
runtime linkage. CI tests it and publishes a PG-major-prefixed SHA tag.
This is a locally tested custom integration, not a vendor certification of Citus/CNPG.

CNPG preloads Citus first, enables 100 prepared transactions and creates the
extension through privileged bootstrap SQL on **fresh** clusters. Existing clusters
need the explicitly approved extension step in the runbook; bootstrap SQL is not
replayed on existing databases. The application role remains non-superuser.

Citus COPY and some parallel queries open internal connections. Loopback-only
`hostssl` rules authenticate the existing CNPG streaming client certificate with
explicit mappings to postgres/clichy. `citus.node_conninfo` verifies the server CA;
verify-ca is used because the endpoint is localhost, not a Service DNS identity.
External clients retain SCRAM. No passwords are copied into SQL or pgpass files,
and certificate rotation remains CNPG-managed. Actual CNPG certificate integration
still needs the Test checkpoint before Production.

Applied Prisma migrations are unchanged. New migration
`20261117140000_unified_cnpg_citus` aligns Production's legacy keys, backfills
nullable outbox owners, removes incompatible global uniqueness and registers
missing tables transactionally. Existing correct Test shards are only validated.
Unexpected metadata or orphan rows fail; no destructive conversion runs automatically.
Dev/local PostgreSQL remains plain PostgreSQL and skips this migration.

## Replication, failure and limits

**What is it?** Physical streaming replays WAL on a standby; promotion makes a
standby writable. Failover is recovery after failure, not a backup.

**Why Clichy uses it** CNPG maintains two instances and redirects its read-write
Service after promotion. Clients must reconnect; interrupted jobs may retry.

```mermaid
flowchart LR
  classDef default fill:#f4f6f8,stroke:#8b98a5,color:#273746
  F["Primary unavailable"] --> C["CNPG detects failure"]
  C --> P["Promote standby to primary"]
  P --> RW["Redirect -rw Service"]
  RW --> A["API / worker reconnect"]
  classDef action fill:#edf5ef,stroke:#72977d,color:#203a29
  class P,RW action
```

This shows the **failover principle**, not a verified Clichy Kubernetes test.
The promoted standby accepts new writes; asynchronous replication can lose
commits not yet received. Both instances on valtask are lost if that host fails.

Two 2 GiB PVCs and the existing CPU/memory budgets are retained. Replication is
asynchronous: recent commits may be lost if the primary fails before replay.
All instances share valtask's disk/host; this is neither horizontal capacity
scaling nor node-level availability. K3s 1.37 remains outside CNPG 1.30's officially
supported matrix even though it is tested; the installer keeps its explicit gate.

Local disposable tests cover non-superuser SCRAM access, certificate-authenticated
Citus COPY, logical restore, streaming and native PostgreSQL promotion with unchanged
shard IDs and subsequent writes. **CNPG-managed failover on Kubernetes is not yet
verified.** The [healthcheck](../operations/scripts.md#healthchecks) observes configuration,
shards and active streaming; it deliberately skips failover testing.
A logical dump restores rows/schema/history, not Citus distribution metadata:
the target must be registered by the versioned migration after restore. Archives
already recording that migration need the explicit reviewed recovery step in the
runbook. Physical WAL replication preserves the target's catalog/shard IDs.
Coordinated database/photo backups and a restore rehearsal are prerequisites to cutover.
See [ADR 0009](../decisions/0009-unified-citus-cnpg.md) for the feasibility basis.
