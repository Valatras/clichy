import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./healthcheck.sh', import.meta.url).pathname;
function run(environment, scenario = '', option) {
  const dir = mkdtempSync(join(tmpdir(), 'clichy-health-test-'));
  const log = join(dir, 'calls');
  const deadline = join(dir, 'timeout');
  writeFileSync(deadline, '#!/usr/bin/env bash\n[[ "$1" == 25s ]] || exit 98\n[[ "$SCENARIO" != timeout ]] || exit 124\nshift\nexec "$@"\n');
  chmodSync(deadline, 0o755);
  const fake = join(dir, 'kubectl');
  writeFileSync(fake, `#!/usr/bin/env bash
printf '%s\\n' "$(echo "$*" | tr '\\n' ' ')" >> "$CALL_LOG"
input=''
if [[ " $* " == *' exec -i '* && "$*" == *ON_ERROR_STOP=1 ]]; then input="$(cat)"; fi
case "$*" in
  *secret*|*apply*|*delete*|*patch*|*create*|*port-forward*|*use-context*) exit 99 ;;
esac
if [[ "$SCENARIO" == inaccessible ]]; then echo 'postgres://private:secret@host' >&2; exit 1; fi
case "$*" in
  *'get deployment'*) [[ "$SCENARIO" == scaled-zero ]] && echo 0 || echo 1 ;;
  *'get pvc'*) printf 'clichy-server-photos=Bound\\nclichy-redis-data=Bound\\ndatabase=Bound\\n' ;;
  *'redis-cli ping'*) echo PONG ;;
  *currentPrimary*) echo clichy-postgres-1 ;;
  *'get pods'*) printf 'clichy-postgres-1 primary\\nclichy-postgres-2 replica\\n' ;;
  *pg_stat_replication*) [[ "$SCENARIO" == no-replica ]] && echo 0 || echo 1 ;;
  *'SELECT count(*) FROM pg_constraint'*) echo 2 ;;
  *'SELECT migration_name'*)
    if [[ "$SCENARIO" != pending ]]; then
      for file in "$MIGRATIONS"/*/migration.sql; do name="\${file%/migration.sql}"; echo "\${name##*/}"; done
    fi ;;
  *'SELECT count(*) FROM '*_prisma_migrations*) echo 0 ;;
  *psql*)
    [[ "$SCENARIO" != bad-citus || "$input" != *pg_dist_partition* ]] || exit 1 ;;
esac
exit 0
`);
  chmodSync(fake, 0o755);
  try {
    const result = spawnSync('bash', [script, environment, ...(option ? [option] : [])], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log,
        SCENARIO: scenario, MIGRATIONS: new URL('../../../packages/db/prisma/migrations', import.meta.url).pathname },
    });
    return { ...result, calls: (() => { try { return readFileSync(log, 'utf8'); } catch { return ''; } })() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('Test succeeds, checks Citus and uses only bounded read operations', () => {
  const result = run('test');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS.*32 shards/);
  assert.match(result.stdout, /WARN.*checksum/);
  assert.doesNotMatch(result.calls, /get secret|apply|delete|patch|create|use-context|migrate deploy/);
  for (const call of result.calls.trim().split('\n')) assert.match(call, /--request-timeout=10s --namespace=clichy-test/);
  assert.match(result.calls, /default_transaction_read_only=on/);
});
test('Production checks replication without Citus SQL', () => {
  const result = run('prod');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS PostgreSQL standby streaming/);
  assert.match(result.stdout, /SKIP Citus/);
  assert.doesNotMatch(result.calls, /clichy-citus|pg_dist_partition/);
});
for (const [environment, scenario, message] of [
  ['test', 'scaled-zero', /FAIL Deployment clichy-server has no available/],
  ['test', 'pending', /FAIL Prisma migration pending/],
  ['test', 'bad-citus', /FAIL Citus reference/],
  ['prod', 'no-replica', /FAIL No streaming standby/],
  ['test', 'inaccessible', /SKIP Remaining/],
  ['test', 'timeout', /FAIL Kubernetes namespace access/],
]) test(`${environment}: ${scenario} fails safely`, () => {
  const result = run(environment, scenario);
  assert.equal(result.status, 1);
  assert.match(result.stdout, message);
  assert.match(result.stdout, /Summary:.*FAIL=[1-9]/);
  assert.doesNotMatch(result.stdout + result.stderr, /private:secret/);
});
test('invalid arguments return 2 before accessing Kubernetes', () => {
  for (const args of [['dev'], ['test', '', '--repair']]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.calls, '');
  }
});

test('shared SQL validator is included by registration and contains no repair', () => {
  const registration = readFileSync(new URL('../citus/enable-user-sharding.sql', import.meta.url), 'utf8');
  const validation = readFileSync(new URL('../citus/validate-user-sharding.sql', import.meta.url), 'utf8');
  assert.match(registration, /\\ir validate-user-sharding.sql/);
  assert.doesNotMatch(validation, /create_distributed_table|create_reference_table|undistribute_table|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\s/i);
});

test('missing kubectl fails with a summary and no dependency installation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clichy-health-deps-'));
  try {
    symlinkSync('/usr/bin/dirname', join(dir, 'dirname'));
    const result = spawnSync('/bin/bash', [script, 'test'], {
      encoding: 'utf8', env: { ...process.env, PATH: dir },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL Required command missing: kubectl/);
    assert.match(result.stdout, /Summary: PASS=0 WARN=0 FAIL=1 SKIP=0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
