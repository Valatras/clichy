# Database replication status

## Current state

Replication is **not implemented** in the current manifests. PostgreSQL runs as a single-replica StatefulSet with one PVC. No streaming replication, standby, replication slot, WAL archive, failover controller, or managed database configuration was found.

A StatefulSet provides stable Pod identity and storage claims; increasing its `replicas` field would create separate PostgreSQL processes and does not configure them as primary/standby replicas. Do not scale this StatefulSet as a replication procedure.

## Future design questions

A replication proposal must choose synchronous/asynchronous behavior, primary election/failover, WAL retention, backup integration, read routing, recovery objectives, and how Prisma migrations execute exactly once. Evaluate a PostgreSQL operator or managed HA database before implementing custom replication. Test failover and restore on disposable data first.
