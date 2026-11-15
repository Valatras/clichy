# Database sharding status

## Current state

Sharding is **not implemented**. Current code connects one Prisma client to one PostgreSQL database. Schema keys and queries are not documented as shard-aware; no routing layer, shard key, distributed transaction behavior, or Citus extension is configured in current manifests.

Git history/context notes that Citus was explored experimentally and was not retained as a validated architecture. The current repo does not establish a working Citus deployment or operational sharding path. Do not treat that experiment as a feature.

## Future work

Before sharding, measure whether a single PostgreSQL instance is the limiting factor. A design would need a shard key (likely user ownership, but this is only a candidate), cross-shard query semantics, rebalancing, migrations, backup/restore, and operational observability. Replication and sharding solve different problems and neither is supplied by multiple Kubernetes Pods.
