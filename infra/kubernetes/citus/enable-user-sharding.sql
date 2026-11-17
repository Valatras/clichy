-- Run after Prisma migrations have created the application tables.
-- Keep identity records replicated; shard photo rows and their outbox by user.
-- Citus otherwise tracks local tables with foreign keys to a reference table
-- as partmethod='n'. They are not sharded and must not satisfy our guards.
SET citus.enable_local_reference_table_foreign_keys = off;

SELECT EXISTS (
  SELECT 1 FROM pg_dist_partition
  WHERE logicalrelid = '"user"'::regclass
) AS user_is_registered \gset
\if :user_is_registered
  \echo 'Identity table is already registered with Citus.'
\else
  SELECT create_reference_table('"user"');
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_dist_partition
  WHERE logicalrelid = '"Photo"'::regclass
) AS photo_is_registered \gset
\if :photo_is_registered
  \echo 'Photo is already registered with Citus; its distribution will be validated.'
\else
  SELECT create_distributed_table('"Photo"', 'userId', shard_count => 32);
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_dist_partition
  WHERE logicalrelid = '"PhotoProcessingOutbox"'::regclass
) AS outbox_is_registered \gset
\if :outbox_is_registered
  \echo 'PhotoProcessingOutbox is already registered with Citus; its distribution will be validated.'
\else
  SELECT create_distributed_table(
    '"PhotoProcessingOutbox"',
    'userId',
    colocate_with => '"Photo"'
  );
\endif

-- Share the read-only postconditions with operational healthchecks.
\ir validate-user-sharding.sql
