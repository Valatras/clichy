# PostgreSQL and Prisma

The current database is a standard PostgreSQL 18 single-instance StatefulSet in each app namespace. The Service name is `clichy-postgres`; the StatefulSet has one replica and a persistent volume claim template. Application credentials and connection URLs are injected from Kubernetes Secrets. This is not replicated PostgreSQL and Kubernetes Pod replication would not provide database replication.

Prisma 7 schema is split across `packages/db/prisma/schema/auth.prisma` and `photo.prisma`. `prisma.config.ts` points at the migration directory and reads `DATABASE_URL`; client generation outputs under `packages/db/prisma/generated`. `createPrismaClient` in `packages/db/src/index.ts` uses the PostgreSQL adapter.

The schema contains Better Auth user/session/account/verification tables, Photo metadata and processing state, and PhotoProcessingOutbox. Photo indexes include user ownership, per-user SHA and perceptual hashes, processing state/start time, and deletion marker. Originals and derivatives are files on a PVC; the database stores storage keys and metadata, not photo bytes.

Migrations are committed under `packages/db/prisma/migrations`. See [migration workflow](migrations.md), [replication status](replication.md), [sharding status](sharding.md), and [backup gaps](backup-restore.md).
