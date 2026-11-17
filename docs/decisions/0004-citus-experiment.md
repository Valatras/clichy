# ADR 0004: Historical Citus experiment

**Status:** Historical decision, superseded by [ADR 0007](0007-replication-sharding.md).

The earlier experiment was abandoned after integration problems. That described
an earlier architecture, not the current deployment.

At the time of ADR 0007, Test used a separate single-Pod Citus database for photo metadata and its
processing outbox, hash-distributed on `userId` with 32 colocated shards.
Dev and Production then used CNPG PostgreSQL without Citus. The separate Test CNPG
cluster was retained for replication exercises and did not replicate Citus data.
The unified target is now described by [ADR 0009](0009-unified-citus-cnpg.md).

See [sharding](../infrastructure/databases.md#citus-logical-sharding) for current constraints and verification,
and [resolved incidents](../operations/troubleshooting.md) for recovery history.
One physical host and one Citus process do not provide multi-node availability.
