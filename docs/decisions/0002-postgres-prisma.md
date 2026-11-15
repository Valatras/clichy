# ADR 0002: PostgreSQL and Prisma

**Status:** Adopted.

## Context

The API needs relational persistence for identity, ownership, photo metadata, and processing state.

## Decision

Use PostgreSQL with Prisma schema and committed migrations. Better Auth uses Prisma's PostgreSQL adapter. Each Kubernetes namespace has a CNPG-managed two-instance PostgreSQL cluster; application writes and Prisma migrations use its `-rw` Service.

## Alternatives considered

No alternatives are recorded in repository history available here.

## Consequences

Prisma provides typed data access and migration history. Schema migrations must be applied to independent environment databases before rollout and remain backward compatible with old Pods. CNPG replication is configured but not live-verified. Sharding, backups and Test refresh are not implemented; same-node instances do not provide physical host HA.
