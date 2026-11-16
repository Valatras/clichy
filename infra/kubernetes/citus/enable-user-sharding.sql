-- Run after Prisma migrations have created the application tables.
-- Keep identity records replicated; shard photo rows and their outbox by user.
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
) AS photo_is_distributed \gset
\if :photo_is_distributed
  \echo 'Photo is already distributed with Citus.'
\else
  SELECT create_distributed_table('"Photo"', 'userId', shard_count => 32);
\endif

SELECT EXISTS (
  SELECT 1 FROM pg_dist_partition
  WHERE logicalrelid = '"PhotoProcessingOutbox"'::regclass
) AS outbox_is_distributed \gset
\if :outbox_is_distributed
  \echo 'PhotoProcessingOutbox is already distributed with Citus.'
\else
  SELECT create_distributed_table(
    '"PhotoProcessingOutbox"',
    'userId',
    colocate_with => '"Photo"'
  );
\endif
