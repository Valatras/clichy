#!/usr/bin/env bash
# Observations only: never source migration/deployment scripts or read Secrets.
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
usage() { echo "Usage: $0 test|prod [--verbose]" >&2; exit 2; }
[[ $# -ge 1 && $# -le 2 ]] || usage
case "$1" in test|prod) environment="$1" ;; *) usage ;; esac
[[ $# -eq 1 || "$2" == --verbose ]] || usage
verbose=false
[[ $# -eq 1 ]] || verbose=true
pass=0 warn=0 fail=0 skip=0
report() {
  local level="$1"; shift
  case "$level" in
    PASS) pass=$((pass + 1)) ;; WARN) warn=$((warn + 1)) ;;
    FAIL) fail=$((fail + 1)) ;; SKIP) skip=$((skip + 1)) ;;
  esac
  printf '%s %s\n' "$level" "$*"
}
summary() {
  printf 'Summary: PASS=%d WARN=%d FAIL=%d SKIP=%d\n' "$pass" "$warn" "$fail" "$skip"
}
trap summary EXIT
for dependency in kubectl timeout; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    report FAIL "Required command missing: $dependency"; exit 1
  fi
done
namespace="clichy-$environment"
# An outer deadline also bounds exec streams, which request-timeout alone does not.
kube() { timeout 25s kubectl --request-timeout=10s --namespace="$namespace" "$@"; }
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then report PASS "$label"; return 0; fi
  report FAIL "$label: unavailable, unexpected state, access denied or timed out (25s)."
  return 1
}
if ! check 'Kubernetes namespace access' kube get namespace "$namespace"; then
  report SKIP 'Remaining checks require namespace access'; exit 1
fi
for app in server web worker redis; do
  check "Deployment clichy-$app rollout" kube rollout status "deployment/clichy-$app" --timeout=15s || true
  available="$(kube get deployment "clichy-$app" -o 'jsonpath={.status.availableReplicas}' 2>/dev/null)" || available=''
  if [[ "$available" =~ ^[1-9][0-9]*$ ]]; then
    report PASS "Deployment clichy-$app has available replicas"
  else report FAIL "Deployment clichy-$app has no available replica or status is inaccessible"; fi
done
if pvc_states="$(kube get pvc -o 'jsonpath={range .items[*]}{.metadata.name}{"="}{.status.phase}{"\n"}{end}' 2>/dev/null)"; then
  if [[ -z "$pvc_states" || "$pvc_states" == *'=Pending'* || "$pvc_states" == *'=Lost'* ]]; then
    report FAIL 'PVCs missing or not Bound'
  else
    all_bound=true
    while IFS= read -r state; do [[ "$state" == *=Bound ]] || all_bound=false; done <<< "$pvc_states"
    if $all_bound; then report PASS 'All existing PVCs Bound'; else report FAIL 'PVC state unknown'; fi
  fi
  for claim in clichy-server-photos clichy-redis-data; do
    if [[ "$pvc_states" == *"$claim=Bound"* ]]; then report PASS "Required PVC $claim"; else report FAIL "Required PVC $claim missing or unbound"; fi
  done
else report FAIL 'Cannot inspect PVCs'; fi
if redis_reply="$(kube exec deployment/clichy-redis -- redis-cli ping 2>/dev/null)" && [[ "$redis_reply" == PONG ]]; then
  report PASS 'Redis PING'
else report FAIL 'Redis PING failed or unexpected response'; fi
# Runs inside the API Pod: verifies service DNS and HTTP without credentials.
check 'Internal API Service HTTP' kube exec deployment/clichy-server -- node -e \
  'fetch("http://clichy-server:3000/", {signal: AbortSignal.timeout(5000)}).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))' || true

if [[ "$environment" == test ]]; then
  database=clichy_test
  target=deployment/clichy-citus
  check 'Citus Deployment rollout' kube rollout status "$target" --timeout=15s || true
else
  database=clichy_prod
  primary="$(kube get cluster.postgresql.cnpg.io clichy-postgres -o 'jsonpath={.status.currentPrimary}' 2>/dev/null)" || primary=''
  check 'CNPG Ready' kube wait --for=condition=Ready cluster.postgresql.cnpg.io/clichy-postgres --timeout=15s || true
  if [[ "$primary" =~ ^clichy-postgres-[0-9]+$ ]]; then
    report PASS "CNPG primary identified: $primary"
    target="pod/$primary"
  else
    report FAIL 'CNPG currentPrimary missing or invalid'
    report SKIP 'SQL and migration checks require a primary'; exit 1
  fi
fi
sql() {
  kube exec -i "$target" -- env PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000' \
    psql -X -qAt -U "$db_user" -d "$database" -v ON_ERROR_STOP=1 "$@"
}
db_user=clichy
[[ "$environment" == test ]] || db_user=postgres
check 'PostgreSQL connectivity' sql -c 'SELECT 1' || true
if [[ "$environment" == test ]]; then
  layout_sql=$(cat <<'SQL'
WITH layout AS (
  SELECT p.logicalrelid, p.partmethod, p.repmodel, p.colocationid,
         CASE WHEN p.partmethod = 'h' THEN column_to_column_name(p.logicalrelid, p.partkey) END AS key,
         (SELECT count(*) FROM pg_dist_shard s WHERE s.logicalrelid = p.logicalrelid) AS shards
  FROM pg_dist_partition p
  WHERE p.logicalrelid IN ('"user"'::regclass, '"Photo"'::regclass, '"PhotoProcessingOutbox"'::regclass)
)
SELECT count(*) = 3
   AND count(*) FILTER (WHERE logicalrelid = '"user"'::regclass AND partmethod = 'n' AND repmodel = 't' AND shards = 1) = 1
   AND count(*) FILTER (WHERE logicalrelid <> '"user"'::regclass AND partmethod = 'h' AND key = 'userId' AND shards = 32 AND colocationid > 0) = 2
   AND (SELECT count(DISTINCT colocationid) FROM layout WHERE logicalrelid <> '"user"'::regclass) = 1
FROM layout;
SQL
)
  if layout="$(sql -c "$layout_sql" 2>/dev/null)" && [[ "$layout" == t ]]; then
    report PASS 'Citus reference table, hash(userId), 32 shards and colocation'
  else report FAIL 'Citus reference/hash layout, shard count or colocation invalid or inaccessible'; fi
  fk_sql=$(cat <<'SQL'
SELECT count(*) FROM pg_constraint
WHERE convalidated AND contype = 'f' AND confupdtype = 'r' AND (
  (conrelid = '"Photo"'::regclass AND confrelid = '"user"'::regclass
   AND pg_get_constraintdef(oid) = 'FOREIGN KEY ("userId") REFERENCES "user"(id) ON UPDATE RESTRICT ON DELETE RESTRICT')
  OR (conrelid = '"PhotoProcessingOutbox"'::regclass AND confrelid = '"Photo"'::regclass
   AND pg_get_constraintdef(oid) = 'FOREIGN KEY ("userId", "photoId") REFERENCES "Photo"("userId", id) ON UPDATE RESTRICT ON DELETE CASCADE'));
SQL
)
  if fk_count="$(sql -c "$fk_sql" 2>/dev/null)" && [[ "$fk_count" == 2 ]]; then report PASS 'Expected validated foreign keys and actions'; else report FAIL 'Expected Photo/User and Outbox/Photo foreign keys missing or incompatible'; fi
else
  if streaming="$(sql -c "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming'" 2>/dev/null)" && [[ "$streaming" =~ ^[1-9][0-9]*$ ]]; then
    report PASS 'PostgreSQL standby streaming from primary'
  else report FAIL 'No streaming standby observed, or replication query denied'; fi
  replicas="$(kube get pods -l cnpg.io/cluster=clichy-postgres -o 'jsonpath={range .items[*]}{.metadata.name}{" "}{.metadata.labels.cnpg\.io/instanceRole}{"\n"}{end}' 2>/dev/null)" || replicas=''
  if [[ "$replicas" == *' replica'* ]]; then report PASS 'CNPG replica identified'; else report FAIL 'CNPG replica not identified'; fi
  report SKIP 'Citus sharding: not configured in Production (CNPG)'
fi
# Compare committed migration names, not only failed-row count. Never print logs.
if applied="$(sql -c 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' 2>/dev/null)"; then
  missing=0
  for migration in "$ROOT_DIR"/packages/db/prisma/migrations/*/migration.sql; do
    name="${migration%/migration.sql}"; name="${name##*/}"
    found=false
    while IFS= read -r row; do [[ "$row" != "$name" ]] || found=true; done <<< "$applied"
    if ! $found; then report FAIL "Prisma migration pending: $name"; missing=$((missing + 1)); fi
  done
  [[ "$missing" -gt 0 ]] || report PASS 'All checkout Prisma migration names applied'
  if failed="$(sql -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL' 2>/dev/null)" && [[ "$failed" == 0 ]]; then report PASS 'No unfinished Prisma migrations'; else report FAIL 'Unfinished Prisma migrations or history inaccessible'; fi
  report WARN 'Migration checks compare names only; checksum drift requires Prisma migrate status'
else report FAIL 'Prisma migration history inaccessible or not initialized'; fi
if $verbose; then
  printf 'Diagnostic scope: namespace=%s database=%s target=%s\n' "$namespace" "$database" "$target"
  echo 'Inspect resources with kubectl get deployments,pods,pvc in this namespace.'
  echo 'Raw command errors are suppressed to avoid credential disclosure.'
fi
[[ "$fail" -eq 0 ]]
