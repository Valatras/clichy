-- Citus is Test-only. Existing migrations remain immutable; this migration
-- takes over the registration previously repeated after every deployment.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE
  expected record;
  method "char";
  replication_model "char";
  distribution_key text;
  shard_total bigint;
  colocation integer;
  photo_colocation integer;
BEGIN
  IF current_database() <> 'clichy_test' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') THEN
    RAISE EXCEPTION 'Test requires the Citus extension before migrations';
  END IF;

  -- Prevent reference-table FKs from registering undistributed photo tables
  -- as local Citus tables before we explicitly distribute them.
  PERFORM set_config('citus.enable_local_reference_table_foreign_keys', 'off', true);
  FOR expected IN
    SELECT * FROM (VALUES
      (1, '"user"'::regclass, 'n', 1),
      (2, '"Photo"'::regclass, 'h', 32),
      (3, '"PhotoProcessingOutbox"'::regclass, 'h', 32)
    ) AS layout(position, relation, method, shards) ORDER BY position
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = expected.relation) THEN
      IF expected.relation = '"user"'::regclass THEN
        PERFORM create_reference_table('"user"');
      ELSIF expected.relation = '"Photo"'::regclass THEN
        PERFORM create_distributed_table('"Photo"', 'userId', shard_count => 32);
      ELSE
        PERFORM create_distributed_table('"PhotoProcessingOutbox"', 'userId', colocate_with => '"Photo"');
      END IF;
    END IF;

    SELECT p.partmethod, p.repmodel,
           CASE WHEN p.partmethod = 'h' THEN column_to_column_name(p.logicalrelid, p.partkey) END,
           (SELECT count(*) FROM pg_dist_shard s WHERE s.logicalrelid = p.logicalrelid),
           p.colocationid
      INTO method, replication_model, distribution_key, shard_total, colocation
      FROM pg_dist_partition p WHERE p.logicalrelid = expected.relation;
    IF method IS DISTINCT FROM expected.method::"char"
       OR shard_total IS DISTINCT FROM expected.shards::bigint
       OR (expected.method = 'n' AND replication_model IS DISTINCT FROM 't'::"char")
       OR (expected.method = 'h' AND distribution_key IS DISTINCT FROM 'userId') THEN
      RAISE EXCEPTION 'Unexpected Citus layout for %; inspect metadata without automatic conversion', expected.relation;
    END IF;
    IF expected.relation = '"Photo"'::regclass THEN
      photo_colocation := colocation;
    ELSIF expected.relation = '"PhotoProcessingOutbox"'::regclass
          AND (colocation IS DISTINCT FROM photo_colocation OR colocation <= 0) THEN
      RAISE EXCEPTION 'Photo and outbox must have the same positive Citus colocation ID';
    END IF;
  END LOOP;
END
$$;
COMMIT;
