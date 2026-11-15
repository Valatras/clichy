# ADR 0002: PostgreSQL and Prisma

**Status:** Adopted.

## Context

The API needs relational persistence for identity, ownership, photo metadata, and processing state.

## Decision

Use PostgreSQL with Prisma schema and committed migrations. Better Auth uses Prisma's PostgreSQL adapter. Each Kubernetes namespace has one PostgreSQL StatefulSet/Service and PVC.

## Alternatives considered

No alternatives are recorded in repository history available here.

## Consequences

Prisma provides typed data access and migration history. Schema migrations must be applied to independent environment databases. The current single instance is a single database availability/failure point; replication, sharding, backups and Test refresh are not implemented.
