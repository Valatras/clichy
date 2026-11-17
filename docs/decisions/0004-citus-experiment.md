# ADR 0004: Historical Citus experiment

**Status:** Historical decision, superseded by [ADR 0007](0007-replication-sharding.md).

The earlier experiment was abandoned after integration problems. That described
an earlier architecture, not the current deployment.

Test now uses a separate single-Pod Citus database for photo metadata and its
processing outbox, hash-distributed on `userId` with 32 colocated shards.
Dev and Production use CNPG PostgreSQL without Citus. The separate Test CNPG
cluster remains for replication exercises and does not replicate Citus data.

See [sharding](../database/sharding.md) for current constraints and verification,
and [resolved incidents](../operations/known-issues.md) for recovery history.
One physical host and one Citus process do not provide multi-node availability.
