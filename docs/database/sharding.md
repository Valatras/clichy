# Citus sharding

## Scope and topology

Test uses a separate Citus 14.2 / PostgreSQL 18 database exposed through `clichy-citus-rw`. The existing two-instance CNPG cluster remains in Test for physical replication exercises. Dev and Production use CNPG directly; the Citus registration script is Test-only.

The intended layout is deliberately small: `user` is a Citus reference table; `Photo` and `PhotoProcessingOutbox` are hash-distributed on `userId`, each with 32 logical shards and the same colocation ID. Related photo and outbox rows for a user can then be routed together. This is logical sharding on one Citus Pod and one physical host, not multi-node scale-out or high availability.

## Prisma schema and Citus constraints

Prisma declares `Photo`'s key as `(userId, id)` and its unique storage key as `(userId, storageKey)`. The outbox key is `(userId, id)`, and its foreign key to Photo is `(userId, photoId) -> (userId, id)`. Every unique/primary key on a hash-distributed table includes its distribution column, and the photo/outbox foreign key includes the same key so it can be enforced on colocated tables. The foreign key from Photo to the reference `user` table is supported by Citus; its delete action is `RESTRICT` to avoid a cross-shard cascade. Both foreign keys use `ON UPDATE RESTRICT`: Citus rejects cascading updates when a foreign key contains the distribution column. User IDs and shard keys are immutable in this application.

The Production branch of migration `20261116090000_citus_user_sharding` retains unique composite indexes while old application Pods may still be serving writes. It does not invoke Citus functions. Test/Dev/local PostgreSQL receive the compound primary keys; Test then performs Citus registration after Prisma migrations.

## Registration and deployment guard

`infra/kubernetes/citus/enable-user-sharding.sql` is mounted in the Citus Pod and run by `infra/kubernetes/scripts/migrate.sh test` after migrations. Citus enables `citus.enable_local_reference_table_foreign_keys` by default; local tables with foreign keys to a reference table can consequently appear in `pg_dist_partition` with `partmethod = 'n'`. The script disables that automatic local-table metadata tracking for its registration session before registering `user`. This avoids mistaking coordinator-local auth tables for reference/distributed photo tables.

The registration script is intentionally non-destructive. It creates missing registrations, then fails unless all of these are true:

- `user` is a reference table (`partmethod = 'n'`, replication model `t`, one shard).
- `Photo` is hash-distributed (`partmethod = 'h'`) on `userId` with exactly 32 shards.
- `PhotoProcessingOutbox` is hash-distributed on `userId` with exactly 32 shards.
- Photo and outbox have the same Citus colocation ID.

Prisma migrations and Citus registration must both succeed before the Test app manifests are applied. An existing registration with the wrong type is reported and left untouched for manual inspection; the deploy path never drops tables, removes PVCs, or converts table types.

## Verify on valtask

The metadata field `pg_dist_partition.partkey` is Citus expression text, not a PostgreSQL expression accepted by `pg_get_expr`. Use Citus' `column_to_column_name` helper:

```sh
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 -c "
SELECT p.logicalrelid::regclass AS table_name,
       p.partmethod,
       column_to_column_name(p.logicalrelid, p.partkey) AS distribution_key,
       p.repmodel,
       p.colocationid,
       count(s.shardid) AS shard_count
FROM pg_dist_partition AS p
LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
WHERE p.logicalrelid IN ('\"user\"'::regclass, '\"Photo\"'::regclass,
                         '\"PhotoProcessingOutbox\"'::regclass)
GROUP BY p.logicalrelid, p.partmethod, p.partkey, p.repmodel, p.colocationid
ORDER BY p.logicalrelid::regclass::text;"
```

Expected: `user` has method `n` and one reference shard; Photo and outbox each have method `h`, key `userId`, 32 shards and the same colocation ID. Re-run the registration/validation script safely with:

```sh
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 \
  -f /opt/clichy/enable-user-sharding.sql
```

It exits nonzero if the expected layout is not present. To inspect routing, run a query scoped by `userId` and inspect its `EXPLAIN` plan; a one-task plan alone does not prove that the table is hash-sharded.

## Existing incorrect registrations: inspect first

Do not rerun a conversion, `undistribute_table`, drop constraints, truncate data, remove the PVC, or recreate the database as an automatic repair. First inspect the current metadata and data, and stop before changing anything if the output is unexpected.

```sh
# Registration, partitioning, colocation and replication metadata (read-only)
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 -c "
SELECT p.logicalrelid::regclass AS table_name,
       p.partmethod,
       column_to_column_name(p.logicalrelid, p.partkey) AS distribution_key,
       p.repmodel,
       p.colocationid,
       count(s.shardid) AS shard_count
FROM pg_dist_partition AS p
LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
GROUP BY p.logicalrelid, p.partmethod, p.partkey, p.repmodel, p.colocationid
ORDER BY p.logicalrelid::regclass::text;"

# Data volumes and outbox state (read-only)
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 -c "
SELECT (SELECT count(*) FROM \"Photo\") AS photos,
       (SELECT count(*) FROM \"PhotoProcessingOutbox\") AS outbox_rows,
       (SELECT count(*) FROM \"PhotoProcessingOutbox\" WHERE \"userId\" IS NULL) AS outbox_without_user;
SELECT \"processingStatus\", count(*)
FROM \"Photo\"
GROUP BY \"processingStatus\"
ORDER BY \"processingStatus\";
SELECT count(*) AS outbox_rows,
       count(*) FILTER (WHERE \"publishedAt\" IS NULL) AS unpublished
FROM \"PhotoProcessingOutbox\";"

# FK definitions (read-only)
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 -c "
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE contype = 'f'
  AND (conrelid IN ('\"Photo\"'::regclass, '\"PhotoProcessingOutbox\"'::regclass)
    OR confrelid IN ('\"Photo\"'::regclass, '\"PhotoProcessingOutbox\"'::regclass))
ORDER BY 1, 2;"
```

### Inspected empty local-table state

The reported Test metadata is `partmethod = 'n'`, `repmodel = 's'`, `colocationid = 0`, and one metadata shard for Photo/outbox; `user` is `n/t`, colocation 1. This identifies Photo/outbox as coordinator-local tables tracked in Citus metadata, not replicated reference tables. Their row counts are zero. The earlier direct execution printed only the old “already distributed” messages, so it ran the previous ConfigMap version without a postcondition validator.

The repository includes a separate, manually gated repair at `infra/kubernetes/citus/repair-empty-local-photo-tables.sql`. It is not called by deployment. It refuses to run unless the database is `clichy_test`, both tables are still empty, their Citus metadata matches the inspected local-table state, User is the expected reference table, and the two expected foreign keys are present. It drops those two FKs, asks Citus to remove local-table metadata, distributes the existing tables by hash, restores the FKs with Citus-compatible update actions, then runs the regular validator. It never drops tables, the database, or PVCs. The repair assumes a write pause and a verified database and photos-volume backup; its explicit psql flags are operator confirmation, not a substitute for taking those backups.

### Partial repair recovery

On 2026-11-17 the guarded empty-state repair created the 32 hash shards for both tables, then stopped while restoring `Photo_userId_fkey`: Citus rejected `ON UPDATE CASCADE` on a foreign key containing the distribution key. The normal Test workflow then applied migration `20261117120000_citus_shard_key_fk_update_restrict`, restoring both FKs with `ON UPDATE RESTRICT`. The user verified the migration history, 32 colocated hash shards, and both parent and shard-level FK definitions on `valtask` at commit `7769af8`. This incident is resolved. Do **not** rerun `repair-empty-local-photo-tables.sql`; it is only for the earlier, guarded empty/local-metadata state.

Before considering that repair:

1. Review the FK query above and confirm there are exactly the expected Photo-to-User and outbox-to-Photo constraints.
2. Pause Test API and worker writes, take and verify a PostgreSQL backup, and take a consistent backup/snapshot of `clichy-server-photos`.
3. Apply the updated Citus Kustomize resources so the new ConfigMap (including the gated repair file) is mounted. The normal deployment validator is expected to fail on the old metadata and will not apply app manifests.
4. Re-run the read-only counts and metadata preflight while writes remain paused. Proceed only if they still match the guarded empty state. Otherwise stop and prepare a data-preserving migration plan for the actual contents.

After the backup and preflight, the separate conversion requires these explicit confirmations:

```sh
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -U clichy -d clichy_test -v ON_ERROR_STOP=1 \
  -v confirm_backup=true -v confirm_empty_test_data=true \
  -f /opt/clichy/repair-empty-local-photo-tables.sql
```

Do not run this command before taking and verifying both backups and pausing writers. If any guard fails, stop; do not weaken the guard or retry with different flags. After success, re-run the validation query and application read/write checks, then resume the Test API and worker. The deployed registration script creates missing registrations and validates existing ones; it never performs this repair automatically.

## Limits

- Test Citus is one Pod and a single point of failure; the CNPG cluster does not provide Citus failover.
- All 32 shards share one process, PVC, CPU/memory budget and host. This validates logical sharding and query routing, not capacity scaling.
- Global dispatcher batches may touch several shards; user-scoped photo lookups and worker jobs carry `userId`.
- Original photos and derivatives remain files on the existing photos PVC; Citus shards metadata, not image bytes.

## References

- [Citus metadata tables](https://learn.microsoft.com/en-us/postgresql/citus/api-metadata?view=citus-14) documents `pg_dist_partition` and shard metadata.
- [Citus utility functions](https://learn.microsoft.com/en-us/postgresql/citus/api-udf?view=citus-14) documents `column_to_column_name` and table distribution APIs.
- [Citus configuration reference](https://learn.microsoft.com/en-us/postgresql/citus/api-guc?view=citus-14) explains why local tables referencing reference tables may enter Citus metadata.
- [Citus DDL reference](https://learn.microsoft.com/en-us/postgresql/citus/reference-ddl?view=citus-14) documents the shard-key requirements for unique keys and colocated foreign keys.
