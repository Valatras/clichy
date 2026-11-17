# ADR 0007: PostgreSQL replication and sharding scope

**Status:** Superseded target by [ADR 0009](0009-unified-citus-cnpg.md). The topology below records the earlier decision; live cutover is separately gated.

## Context

Assignment asks for replication and sharding. The previous configuration used a single PostgreSQL StatefulSet. The educational prototype remains on one physical K3s node and does not need node-level HA.

## Decision

Use CloudNativePG to manage two PostgreSQL instances per environment with asynchronous physical streaming, separate PVCs, automatic Pod recovery/promotion, and the `-rw` Service for application connections. Test additionally uses Citus with `userId` as the distribution key for photo metadata and processing-outbox rows. Dev and Production remain plain CNPG PostgreSQL. Keep replication and sharding as separate concerns. Do not scale database Pods directly.

## Alternatives considered

A PostgreSQL operator is selected for physical replication. Multi-node Citus was deferred because it introduces worker membership and failure management. A single-node Citus instance in Test provides 32 logical shards and a low-complexity path to validate Citus routing. Synchronous replication is not selected because the prototype does not require zero data loss and asynchronous streaming avoids making writes wait on the standby.

## Consequences

CNPG remains responsible for the replication exercise. Test Citus has one database Pod and no high availability; the CNPG Test cluster remains deployed separately. The 32 logical shards share one PostgreSQL process and host, so this is not multi-node capacity scaling or failure isolation. The data model uses compound keys containing `userId`, and outbox jobs carry that key so queries can be routed. Citus and Prisma migrations must stay aligned.
