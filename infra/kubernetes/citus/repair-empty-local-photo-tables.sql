-- Manual, gated repair for the inspected empty Test state only.
-- This is intentionally not invoked by any deployment script.
\if :confirm_backup
\else
  \echo 'Refusing repair: confirm a database and photos-volume backup with -v confirm_backup=true.'
  \quit 3
\endif
\if :confirm_empty_test_data
\else
  \echo 'Refusing repair: confirm the empty-table preflight with -v confirm_empty_test_data=true.'
  \quit 3
\endif

SET citus.enable_local_reference_table_foreign_keys = off;

DO $$
DECLARE
  photo_rows bigint;
  outbox_rows bigint;
  photo_method "char";
  photo_repmodel "char";
  photo_colocation integer;
  photo_shards bigint;
  outbox_method "char";
  outbox_repmodel "char";
  outbox_colocation integer;
  outbox_shards bigint;
  user_method "char";
  user_repmodel "char";
  user_shards bigint;
  target_foreign_keys bigint;
  expected_foreign_keys bigint;
BEGIN
  IF current_database() <> 'clichy_test' THEN
    RAISE EXCEPTION 'Refusing repair outside clichy_test (connected to %)', current_database();
  END IF;

  SELECT count(*) INTO photo_rows FROM "Photo";
  SELECT count(*) INTO outbox_rows FROM "PhotoProcessingOutbox";
  IF photo_rows <> 0 OR outbox_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing empty-table repair: Photo has % rows and outbox has % rows',
      photo_rows, outbox_rows;
  END IF;

  SELECT p.partmethod, p.repmodel, count(s.shardid)
    INTO user_method, user_repmodel, user_shards
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"user"'::regclass
   GROUP BY p.partmethod, p.repmodel;
  IF user_method IS DISTINCT FROM 'n'::"char"
     OR user_repmodel IS DISTINCT FROM 't'::"char"
     OR user_shards IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Refusing repair: "user" is not the expected one-shard reference table (method %, model %, shards %)',
      user_method, user_repmodel, user_shards;
  END IF;

  SELECT p.partmethod, p.repmodel, p.colocationid, count(s.shardid)
    INTO photo_method, photo_repmodel, photo_colocation, photo_shards
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"Photo"'::regclass
   GROUP BY p.partmethod, p.repmodel, p.colocationid;
  SELECT p.partmethod, p.repmodel, p.colocationid, count(s.shardid)
    INTO outbox_method, outbox_repmodel, outbox_colocation, outbox_shards
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"PhotoProcessingOutbox"'::regclass
   GROUP BY p.partmethod, p.repmodel, p.colocationid;

  IF photo_method IS DISTINCT FROM 'n'::"char"
     OR photo_repmodel IS DISTINCT FROM 's'::"char"
     OR photo_colocation IS DISTINCT FROM 0
     OR photo_shards IS DISTINCT FROM 1
     OR outbox_method IS DISTINCT FROM 'n'::"char"
     OR outbox_repmodel IS DISTINCT FROM 's'::"char"
     OR outbox_colocation IS DISTINCT FROM 0
     OR outbox_shards IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Refusing repair: expected the inspected local-table metadata state; Photo=(%,%,%,%), Outbox=(%,%,%,%)',
      photo_method, photo_repmodel, photo_colocation, photo_shards,
      outbox_method, outbox_repmodel, outbox_colocation, outbox_shards;
  END IF;

  SELECT count(*) INTO target_foreign_keys
    FROM pg_constraint
   WHERE contype = 'f'
     AND (conrelid IN ('"Photo"'::regclass, '"PhotoProcessingOutbox"'::regclass)
       OR confrelid IN ('"Photo"'::regclass, '"PhotoProcessingOutbox"'::regclass));
  SELECT count(*) INTO expected_foreign_keys
    FROM pg_constraint
   WHERE contype = 'f'
     AND ((conname = 'Photo_userId_fkey'
           AND conrelid = '"Photo"'::regclass
           AND confrelid = '"user"'::regclass)
       OR (conname = 'PhotoProcessingOutbox_userId_photoId_fkey'
           AND conrelid = '"PhotoProcessingOutbox"'::regclass
           AND confrelid = '"Photo"'::regclass));
  IF target_foreign_keys <> 2 OR expected_foreign_keys <> 2 THEN
    RAISE EXCEPTION 'Refusing repair: expected exactly the two known Photo/outbox foreign keys; found % relevant FKs and % expected FKs',
      target_foreign_keys, expected_foreign_keys;
  END IF;
END
$$;

-- Remove only the two FKs that keep these coordinator-local tables connected.
-- Citus then prunes their local-table metadata; the tables themselves remain.
ALTER TABLE "PhotoProcessingOutbox"
  DROP CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey";
ALTER TABLE "Photo"
  DROP CONSTRAINT "Photo_userId_fkey";
SELECT remove_local_tables_from_metadata();

SELECT create_distributed_table('"Photo"', 'userId', shard_count => 32);
SELECT create_distributed_table(
  '"PhotoProcessingOutbox"',
  'userId',
  colocate_with => '"Photo"'
);

ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhotoProcessingOutbox"
  ADD CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"
  FOREIGN KEY ("userId", "photoId") REFERENCES "Photo"("userId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

\i /opt/clichy/enable-user-sharding.sql
