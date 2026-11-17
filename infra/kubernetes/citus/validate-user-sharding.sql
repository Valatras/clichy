-- Existing registrations are not automatically converted: reference-to-hash
-- conversion can change data placement and requires an inspected recovery plan.
DO $$
DECLARE
  user_method "char";
  user_repmodel "char";
  user_shards bigint;
  photo_method "char";
  photo_key text;
  photo_shards bigint;
  photo_colocation integer;
  outbox_method "char";
  outbox_key text;
  outbox_shards bigint;
  outbox_colocation integer;
BEGIN
  SELECT p.partmethod, p.repmodel, count(s.shardid)
    INTO user_method, user_repmodel, user_shards
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"user"'::regclass
   GROUP BY p.partmethod, p.repmodel;
  IF user_method IS DISTINCT FROM 'n'::"char"
     OR user_repmodel IS DISTINCT FROM 't'::"char"
     OR user_shards IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Citus sharding validation failed: "user" must be a reference table (method n, model t, one shard), got method=%, model=%, shards=%',
      user_method, user_repmodel, user_shards;
  END IF;

  SELECT p.partmethod,
         column_to_column_name(p.logicalrelid, p.partkey),
         count(s.shardid),
         p.colocationid
    INTO photo_method, photo_key, photo_shards, photo_colocation
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"Photo"'::regclass
   GROUP BY p.logicalrelid, p.partmethod, p.partkey, p.colocationid;

  IF photo_method IS DISTINCT FROM 'h'::"char"
     OR photo_key IS DISTINCT FROM 'userId'
     OR photo_shards IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Citus sharding validation failed for "Photo": expected hash(userId), 32 shards; got method=%, key=%, shards=%',
      photo_method, photo_key, photo_shards;
  END IF;

  SELECT p.partmethod,
         column_to_column_name(p.logicalrelid, p.partkey),
         count(s.shardid),
         p.colocationid
    INTO outbox_method, outbox_key, outbox_shards, outbox_colocation
    FROM pg_dist_partition AS p
    LEFT JOIN pg_dist_shard AS s USING (logicalrelid)
   WHERE p.logicalrelid = '"PhotoProcessingOutbox"'::regclass
   GROUP BY p.logicalrelid, p.partmethod, p.partkey, p.colocationid;

  IF outbox_method IS DISTINCT FROM 'h'::"char"
     OR outbox_key IS DISTINCT FROM 'userId'
     OR outbox_shards IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Citus sharding validation failed for "PhotoProcessingOutbox": expected hash(userId), 32 shards; got method=%, key=%, shards=%',
      outbox_method, outbox_key, outbox_shards;
  END IF;

  IF outbox_colocation IS DISTINCT FROM photo_colocation THEN
    RAISE EXCEPTION 'Citus sharding validation failed: photo/outbox colocation IDs differ (Photo %, PhotoProcessingOutbox %)',
      photo_colocation, outbox_colocation;
  END IF;
END
$$;

\echo 'Citus sharding validated: Photo and PhotoProcessingOutbox use hash(userId), 32 colocated shards.'
