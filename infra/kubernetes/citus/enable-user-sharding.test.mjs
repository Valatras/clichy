import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registrationSql = await readFile(
  new URL("./enable-user-sharding.sql", import.meta.url),
  "utf8",
);
const photoSchema = await readFile(
  new URL("../../../packages/db/prisma/schema/photo.prisma", import.meta.url),
  "utf8",
);
const citusMigration = await readFile(
  new URL("../../../packages/db/prisma/migrations/20261116090000_citus_user_sharding/migration.sql", import.meta.url),
  "utf8",
);
const migrateScript = await readFile(
  new URL("../scripts/migrate.sh", import.meta.url),
  "utf8",
);
const emptyRepairSql = await readFile(
  new URL("./repair-empty-local-photo-tables.sql", import.meta.url),
  "utf8",
);

test("photo tables are created as userId hash shards and colocated", () => {
  assert.match(
    registrationSql,
    /create_distributed_table\('\"Photo\"',\s*'userId',\s*shard_count\s*=>\s*32\)/,
  );
  assert.match(
    registrationSql,
    /create_distributed_table\([\s\S]*?'\"PhotoProcessingOutbox\"'[\s\S]*?'userId'[\s\S]*?colocate_with\s*=>\s*'\"Photo\"'/,
  );
});

test("existing registrations are validated instead of accepted by presence", () => {
  assert.match(registrationSql, /photo_method IS DISTINCT FROM 'h'::"char"/);
  assert.match(registrationSql, /outbox_method IS DISTINCT FROM 'h'::"char"/);
  assert.match(registrationSql, /photo_key IS DISTINCT FROM 'userId'/);
  assert.match(registrationSql, /outbox_key IS DISTINCT FROM 'userId'/);
  assert.match(registrationSql, /photo_shards IS DISTINCT FROM 32/);
  assert.match(registrationSql, /outbox_shards IS DISTINCT FROM 32/);
  assert.match(registrationSql, /outbox_colocation IS DISTINCT FROM photo_colocation/);
  assert.match(registrationSql, /RAISE EXCEPTION 'Citus sharding validation failed/);
  assert.match(registrationSql, /user_repmodel IS DISTINCT FROM 't'::"char"/);
});

test("reference-table foreign keys cannot pre-register the photo tables as local references", () => {
  const disableLocalReferenceTracking = registrationSql.indexOf(
    "SET citus.enable_local_reference_table_foreign_keys = off",
  );
  const createUserReference = registrationSql.indexOf(
    "create_reference_table('\"user\"')",
  );

  assert.notEqual(disableLocalReferenceTracking, -1);
  assert.ok(createUserReference > disableLocalReferenceTracking);
});

test("Prisma keys and foreign keys satisfy Citus distribution-key requirements", () => {
  assert.match(photoSchema, /@@id\(\[userId, id\]\)/);
  assert.match(photoSchema, /@@unique\(\[userId, storageKey\]\)/);
  assert.match(photoSchema, /fields: \[userId, photoId\], references: \[userId, id\]/);
  assert.match(citusMigration, /PRIMARY KEY \("userId", "id"\)/);
  assert.match(citusMigration, /FOREIGN KEY \("userId", "photoId"\)/);
  assert.match(citusMigration, /CREATE UNIQUE INDEX IF NOT EXISTS "Photo_userId_storageKey_key"\s+ON "Photo"\("userId", "storageKey"\)/);
});

test("registration does not silently destructively convert existing tables", () => {
  assert.doesNotMatch(registrationSql, /undistribute_table\s*\(/i);
  assert.doesNotMatch(registrationSql, /DROP\s+TABLE/i);
  assert.doesNotMatch(registrationSql, /TRUNCATE\s+/i);
});

test("Test deployment stops when the Citus registration or validation SQL fails", () => {
  assert.match(migrateScript, /--set ON_ERROR_STOP=1[\s\S]*?--file=\/opt\/clichy\/enable-user-sharding\.sql/);
  assert.match(migrateScript, /Test Citus sharding registration or validation failed/);
});

test("the empty-table repair is manual, explicitly confirmed, and guarded by live preflight checks", () => {
  assert.match(emptyRepairSql, /\\if :confirm_backup/);
  assert.match(emptyRepairSql, /\\if :confirm_empty_test_data/);
  assert.match(emptyRepairSql, /current_database\(\) <> 'clichy_test'/);
  assert.match(emptyRepairSql, /photo_rows <> 0 OR outbox_rows <> 0/);
  assert.match(emptyRepairSql, /photo_repmodel IS DISTINCT FROM 's'/);
  assert.match(emptyRepairSql, /outbox_repmodel IS DISTINCT FROM 's'/);
  assert.doesNotMatch(migrateScript, /repair-empty-local-photo-tables/);
  assert.doesNotMatch(emptyRepairSql, /DROP\s+TABLE|TRUNCATE\s+/i);
});
