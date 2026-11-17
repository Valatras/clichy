# PostgreSQL and Prisma

CNPG 1.30.1 with PostgreSQL 18.6 provides two-instance clusters in Dev, Test, and Production for physical replication exercises. Dev and Production applications use CNPG's `clichy-postgres-rw` Service. Test additionally runs a separate single-node Citus 14.2/PostgreSQL 18 database, and the Test application uses `clichy-citus-rw` for its logically sharded photo tables. The Test CNPG cluster remains available for replication demonstrations. See [Citus sharding](sharding.md) for scope and limitations.

Production's operator and two-instance Cluster are deployed on `valtask`. The evidence currently recorded confirms Cluster readiness and database connectivity, but does not yet include a live WAL sender/receiver query or a failover exercise. Check those using the [Replication runbook](replication.md). Dev/Test live status should be verified separately. Both instances use separate PVCs but remain on the same physical node. This provides practice with PostgreSQL replication and Pod/storage recovery, not protection against loss of `valtask`.

CNPG 1.30.1 supports Kubernetes 1.34–1.36; Kubernetes 1.37 has been tested by the release but is not listed as officially supported. The repository's K3s installer targets 1.37, and K3s itself is not a Kubernetes distribution covered by CNPG's vanilla-Kubernetes support policy. The pinned installer requires an explicit opt-in for a 1.37 server. See the [official support matrix](https://cloudnative-pg.io/docs/1.30/supported_releases/).

Prisma 7 schema is split across `packages/db/prisma/schema/auth.prisma` and `photo.prisma`. `prisma.config.ts` points at the migration directory and reads `DATABASE_URL`; client generation outputs under `packages/db/prisma/generated`. `createPrismaClient` in `packages/db/src/index.ts` uses the PostgreSQL adapter against CNPG or Citus.

The schema contains Better Auth user/session/account/verification tables, Photo metadata and processing state, and PhotoProcessingOutbox. Photo and outbox keys include `userId` so Citus can colocate each user's rows. Photo indexes include user ownership, per-user SHA and perceptual hashes, processing state/start time, and deletion marker. Originals and derivatives are files on a PVC; the database stores storage keys and metadata, not photo bytes.

Migrations are committed under `packages/db/prisma/migrations`. See [migration workflow](migrations.md), [replication status](replication.md), [sharding status](sharding.md), and [backup gaps](backup-restore.md).
