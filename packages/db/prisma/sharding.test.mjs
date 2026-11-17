import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const directory = new URL('./migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => /^\d/.test(name) && existsSync(new URL(`${name}/migration.sql`, directory))).sort();
const sql = name => readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8');
const registrationName = '20261117130000_register_citus_sharding';
const registration = sql(registrationName);
const migrate = readFileSync(new URL('../../../infra/kubernetes/scripts/migrate.sh', import.meta.url), 'utf8');
const healthcheck = readFileSync(new URL('../../../infra/kubernetes/scripts/healthcheck.sh', import.meta.url), 'utf8');

test('migration owns registration; deployment has no extra SQL or incident resolution', () => {
  assert.match(registration, /current_database\(\) <> 'clichy_test'/);
  assert.match(registration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(registration, /undistribute_table|DROP\s|TRUNCATE\s/i);
  assert.doesNotMatch(migrate, /kubectl exec|resolve-citus-failure|enable-user-sharding/);
  assert.match(migrate, /db:migrate:deploy/);
});
test('healthcheck observes Citus without registration or repair', () => {
  assert.match(healthcheck, /default_transaction_read_only=on/);
  assert.match(healthcheck, /pg_dist_partition/);
  assert.doesNotMatch(healthcheck, /create_distributed_table|create_reference_table|undistribute_table/);
});

test('removed incident-resolution action is rejected before database access', () => {
  for (const environment of ['test', 'prod']) {
    const result = spawnSync('bash', [new URL('../../../infra/kubernetes/scripts/migrate.sh', import.meta.url).pathname,
      environment, 'resolve-citus-failure'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:.*deploy\|status/);
  }
});

// Opt-in integration uses one isolated, disposable container, no host ports or
// host mounts. SQL is sent through stdin; no real cluster/database is involved.
test('Citus migration lifecycle', { skip: process.env.CLICHY_TEST_CITUS !== '1', timeout: 120000 }, async t => {
  function docker(args, input) {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  }
  const container = docker(['run', '--rm', '-d', '--network', 'none',
    '--tmpfs', '/var/lib/postgresql:rw',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=clichy',
    '-e', 'POSTGRES_DB=clichy_test', 'citusdata/citus:14.2.0']);
  const query = (statement, database = 'clichy_test') => docker(
    ['exec', '-i', container, 'psql', '-XqAt', '-U', 'clichy', '-d', database, '-v', 'ON_ERROR_STOP=1'], statement);
  const reset = (database, citus) => {
    query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE);`, 'postgres');
    query(`CREATE DATABASE ${database};`, 'postgres');
    if (citus) query('CREATE EXTENSION citus;', database);
    for (const migration of migrations.slice(0, migrations.indexOf(registrationName))) query(sql(migration), database);
  };
  const rows = `
    INSERT INTO "user" (id,name,email,"updatedAt") VALUES ('u','User','u@example.test',now());
    INSERT INTO "Photo" (id,"userId",filename,"mimeType",size,"storageKey") VALUES ('p','u','photo.jpg','image/jpeg',1,'original');
    INSERT INTO "PhotoProcessingOutbox" (id,"userId","photoId") VALUES ('o','u','p');`;
  const shardIds = () => query('SELECT string_agg(shardid::text,\',\' ORDER BY shardid) FROM pg_dist_shard;');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'clichy', '-d', 'clichy_test'], { encoding: 'utf8' });
      if (probe.status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'disposable Citus failed to start');
    await t.test('clean image initializes extension; all migrations create 32 colocated shards', () => {
      assert.equal(query("SELECT count(*) FROM pg_extension WHERE extname='citus';"), '1');
      for (const migration of migrations) query(sql(migration));
      assert.equal(query(`SELECT count(*) FROM pg_dist_shard WHERE logicalrelid IN ('"Photo"'::regclass,'"PhotoProcessingOutbox"'::regclass);`), '64');
      assert.equal(query(`SELECT count(DISTINCT colocationid) FROM pg_dist_partition WHERE logicalrelid IN ('"Photo"'::regclass,'"PhotoProcessingOutbox"'::regclass);`), '1');
      query(rows);
    });
    await t.test('existing correct shards and data are unchanged', () => {
      const before = shardIds();
      query(registration);
      assert.equal(shardIds(), before);
      assert.equal(query('SELECT count(*) FROM "Photo"; SELECT count(*) FROM "PhotoProcessingOutbox";'), '1\n1');
      assert.throws(() => query(`INSERT INTO "PhotoProcessingOutbox" (id,"userId","photoId") VALUES ('bad','u','missing');`), /foreign key/i);
    });
    await t.test('healthcheck catalog SQL accepts the real layout and foreign keys in read-only mode', () => {
      for (const [name, expected] of [['layout_sql', 't'], ['fk_sql', '2']]) {
        const statement = healthcheck.split(`${name}=$(cat <<'SQL'\n`)[1].split('\nSQL')[0];
        assert.equal(query(`BEGIN READ ONLY;\n${statement}\nROLLBACK;`), expected);
      }
    });
    await t.test('existing nonempty unregistered tables distribute without data loss', () => {
      reset('clichy_test', true);
      query(rows);
      query(registration);
      assert.equal(query('SELECT count(*) FROM "Photo"; SELECT count(*) FROM "PhotoProcessingOutbox";'), '1\n1');
    });
    await t.test('incorrect local registrations fail without conversion or data loss', () => {
      reset('clichy_test', true);
      query(rows);
      query('SELECT create_reference_table(\'"user"\');');
      const before = shardIds();
      assert.throws(() => query(registration), /Unexpected Citus layout/);
      assert.equal(shardIds(), before);
      const layout = healthcheck.split("layout_sql=$(cat <<'SQL'\n")[1].split('\nSQL')[0];
      assert.equal(query(layout), 'f');
      assert.equal(query('SELECT count(*) FROM "Photo";'), '1');
    });
    await t.test('late invariant failure rolls back registrations created earlier in the transaction', () => {
      reset('clichy_test', true);
      query(rows);
      query('ALTER TABLE "PhotoProcessingOutbox" DROP CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"; SELECT create_reference_table(\'"PhotoProcessingOutbox"\');');
      const before = shardIds();
      assert.throws(() => query(registration), /Unexpected Citus layout/);
      assert.equal(shardIds(), before);
      assert.equal(query('SELECT count(*) FROM "Photo"; SELECT count(*) FROM "PhotoProcessingOutbox";'), '1\n1');
    });
    await t.test('Test without extension fails explicitly', () => {
      reset('clichy_test', false);
      assert.throws(() => query(registration), /requires the Citus extension/);
    });
    for (const database of ['clichy_prod', 'clichy']) {
      await t.test(`${database} stays plain PostgreSQL`, () => {
        reset(database, false);
        query(registration, database);
        assert.equal(query("SELECT count(*) FROM pg_extension WHERE extname='citus';", database), '0');
        assert.equal(query('SELECT count(*) FROM "Photo";', database), '0');
      });
    }
  } finally {
    docker(['rm', '-f', container]);
  }
});
