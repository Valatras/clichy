# ADR 0007: PostgreSQL replication and sharding scope

**Status:** Replication selected and configured with CNPG; sharding remains unimplemented.

## Context

Assignment asks for replication and sharding. The previous configuration used a single PostgreSQL StatefulSet. The educational prototype remains on one physical K3s node and does not need node-level HA.

## Decision

Use CloudNativePG to manage two PostgreSQL instances per environment with asynchronous physical streaming, separate PVCs, automatic Pod recovery/promotion, and the `-rw` Service for application connections. This is intended to demonstrate PostgreSQL replication mechanics, not protect against physical host failure. Do not implement sharding as part of the replication work; it remains an assignment requirement and needs a separate design decision. Do not scale database Pods directly.

## Alternatives considered

A PostgreSQL operator is selected over custom StatefulSet replication. Citus remains excluded. Synchronous replication is not selected because the prototype does not require zero data loss and asynchronous streaming avoids making writes wait on the standby.

## Consequences

CNPG is deployed in Production and the Cluster was observed healthy with two instances; a direct WAL streaming query and failover exercise are not yet evidenced. Both instances share the same node, asynchronous replication may lose recent unreplicated writes, and replication is not a backup. Sharding remains absent.
