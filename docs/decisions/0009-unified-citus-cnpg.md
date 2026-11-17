# ADR 0009: Unified local Citus sharding with CNPG replication

**Status:** Accepted target; repository implementation and local proofs complete.
Manual Test cutover, CNPG certificate validation and controlled switchover remain
required before Production. Supersedes the target in [ADR 0007](0007-replication-sharding.md).

## Decision

Test and Production use one CNPG cluster each, two PostgreSQL 18.6 instances,
Citus 14.2, and 32 colocated Photo/outbox shards on userId inside the primary.
WAL replicates shards and Citus metadata. There are no external Citus workers.
Dev/local stays plain PostgreSQL. Retain namespace Secrets and existing PVCs.

Use a digest-pinned CNPG-derived image. Citus must preload first. Reuse CNPG's
rotating streaming client certificate for Citus loopback connections, with
explicit postgres/clichy mappings; do not weaken network SCRAM to trust.
The CA is verified; loopback does not require a Service hostname certificate.

A new immutable migration aligns the old Production schema before distribution.
Application releases wait for a manually acknowledged cutover and never roll the
database image implicitly. Database image changes are explicit preparation operations.

## Feasibility and evidence

- [Citus 14.2 source](https://github.com/citusdata/citus/tree/v14.2.0) supports PG18 and a single-node coordinator.
- [Citus failure handling](https://learn.microsoft.com/en-us/postgresql/citus/cluster-management?view=citus-14#coordinator-node-failures) describes coordinator streaming replication and promotion.
- [CNPG 1.30 image requirements](https://cloudnative-pg.io/docs/1.30/container_images/) allow compatible PostgreSQL images and a primary/standby topology; image tags must expose the major version.
- [CNPG 1.30.1 configuration source](https://github.com/cloudnative-pg/cloudnative-pg/blob/v1.30.1/pkg/postgres/configuration.go) preserves user preload order and defines the certificate paths, HBA rules and identity mappings used here.

These establish a viable design, not an upstream guarantee for the combination.
Local image tests load Citus on PG18.6 and migrate Test/legacy Production as a
non-superuser. They restore a logical dump, replicate over WAL, stop the old
primary and promote the standby; existing shard IDs and application reads/writes
survive. Test certificates are fixtures; the actual operator/Service/certificate
lifecycle must still be verified on valtask. Native promotion is not a CNPG
failover test. K3s 1.37 is tested but not officially supported by CNPG 1.30.

## Transition and rollback

The inspected old CNPG Test database contains a distinct user/photo/outbox row.
Import active Citus rows/schema/history into a separate database, then retain the old CNPG database
under a different name during cutover. Preserve every Prisma history row,
including the rolled-back attempt. Logical dumps do not restore Citus catalogs;
new migration 20261117140000 registers the restored canonical target. A later
archive already containing that migration needs explicit reviewed SQL replay;
`migrate deploy` alone cannot reconstruct missing distribution. Do not discard
either original dataset.

Production conversion is in place and transactional, after backups and a write
pause. A failed migration leaves its database transaction unchanged; Prisma
failure history still requires diagnosis. After committed DDL, rollback uses a
verified restore into another database and a controlled name switch, keeping
the Citus-capable image. Never remove required binaries or discard post-cutover writes.
The [runbook](../operations/deployment.md#controlled-cutover) defines checkpoints.
Old standalone Test manifests are retained only until migration is verified;
normal deployment no longer references them. Remove them in the cleanup checkpoint,
while retaining the old PVC and backup for rollback.
