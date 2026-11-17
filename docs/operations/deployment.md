# Deployment and migrations

**What is it?** Deployment rolls out application images; migration evolves schema.
Database image preparation is a separate, deliberately approved operation.

**Why Clichy uses it** Matching commit/image SHAs, namespace Secrets and
migration-before-application ordering protect releases and existing data.

## Normal operation after cutover

Pushes to master deploy Test after CI. Production requires manual dispatch with
`deploy_prod=true` and its GitHub environment protections. From a clean checkout
matching published images, `deploy.sh test|prod sha-<40-hex>` verifies valtask/SHA,
confirms, checks CNPG, migrates, renders exact-SHA application manifests and waits
for Web/API/worker rollouts. It does **not** update the database image or apply the
old standalone Citus resources. CI explicitly sets `CLICHY_DEPLOY_CONFIRM=yes`.

Both application/migration connections use `clichy-postgres-rw`. `migrate.sh <env>
status` is a Prisma diagnostic; `migrate.sh <env> deploy` applies pending SQL via
an ephemeral loopback port-forward. The script validates the Secret's host/base
without printing its URL and cleans processes/credentials. Loopback forwarding
uses sslmode=disable for SCRAM; Citus's internal connections use certificates.
A migration failure prevents application rollout. Applied SQL remains immutable.

The one-time `clichy.io/database-architecture=cnpg-citus-v1` Cluster acknowledgement
is required before a release may proceed. It prevents an ordinary push from
silently choosing the old, unrelated Test CNPG database. Until the controlled
cutover below is complete, this explicit refusal is expected.

## Controlled cutover

**Operator procedure, not commands already executed.** Test first, Production only
after Test restoration, application processing and CNPG switchover are verified.
The operations below pause service, modify databases/Secrets and may change the
primary. They require explicit approval, a maintenance window, verified database
and photos backups, enough disk space, and a clean published checkout. No backup
has yet been confirmed from valtask. Do not run the whole page unattended.

### 1. Publish and prepare backups

Let CI build/test/package the reviewed commit. Its database image is
`ghcr.io/valatras/clichy-postgres:18.6-citus14.2.0-sha-<commit>`.
The Test deployment is intentionally blocked by the acknowledgement until cutover.
Do not manually dispatch Production as a shortcut.

For one environment at a time, start with `NS=clichy-test` (later `clichy-prod`).
Save original replica counts and stop writers; this causes application downtime.
The zero replica setting suspends HPA activity until explicitly scaled back up.

```bash
set -euo pipefail
NS=clichy-test
test "$(kubectl get nodes -o 'jsonpath={range .items[*]}{.metadata.name}{end}')" = valtask || { echo 'Expected only valtask'; exit 1; }
umask 077
BACKUP_DIR="$HOME/clichy-backups/$(date +%Y%m%d-%H%M%S)-$NS"
mkdir -p "$BACKUP_DIR"
printf '%s\n' "$NS" > "$BACKUP_DIR/namespace"
kubectl get deployment clichy-server clichy-worker -n "$NS" -o yaml > "$BACKUP_DIR/writers.yaml"
kubectl get cluster.postgresql.cnpg.io clichy-postgres -n "$NS" -o yaml > "$BACKUP_DIR/cluster.yaml"
# Credential backup: protected file only; do not display or share it.
secret=clichy-server-secrets
[ "$NS" != clichy-prod ] || secret=clichy-prod-secrets
kubectl get secret "$secret" -n "$NS" -o json > "$BACKUP_DIR/app-secret.json"
kubectl scale deployment/clichy-server deployment/clichy-worker -n "$NS" --replicas=0
kubectl wait --for=delete pod -n "$NS" -l app=clichy-server --timeout=180s
kubectl wait --for=delete pod -n "$NS" -l app=clichy-worker --timeout=180s
primary="$(kubectl get cluster.postgresql.cnpg.io clichy-postgres -n "$NS" -o 'jsonpath={.status.currentPrimary}')"
db=clichy_test
[ "$NS" != clichy-prod ] || db=clichy_prod
kubectl exec -n "$NS" "$primary" -c postgres -- pg_dump -U postgres -Fc -d "$db" > "$BACKUP_DIR/cnpg.dump"
if [ "$NS" = clichy-test ]; then
  kubectl exec -n "$NS" deployment/clichy-citus -c postgres -- pg_dump -U clichy -Fc -d clichy_test > "$BACKUP_DIR/active-citus.dump"
fi
```

Stop on any failed command; never treat a partial dump as a backup. Both Test
sources must be backed up: the inactive CNPG database has a distinct row/history.
The active Citus dump is the source for the new application database.

Back up the quiesced photos volume through a temporary read-only Pod. This Pod
uses the already-deployed application image, contains no application Secret env,
and is deleted afterwards; the PVC is never deleted.

```bash
image="$(kubectl get deployment clichy-server -n "$NS" -o 'jsonpath={.spec.template.spec.containers[0].image}')"
kubectl run photo-backup -n "$NS" --image="$image" --restart=Never --override-type=strategic \
  --overrides='{"spec":{"imagePullSecrets":[{"name":"ghcr-pull-secret"}],"securityContext":{"runAsNonRoot":true,"runAsUser":10001,"runAsGroup":2000,"supplementalGroups":[1000]},"containers":[{"name":"photo-backup","volumeMounts":[{"name":"photos","mountPath":"/data/photos","readOnly":true}]}],"volumes":[{"name":"photos","persistentVolumeClaim":{"claimName":"clichy-server-photos","readOnly":true}}]}}' \
  --command -- sleep 3600
kubectl wait pod/photo-backup -n "$NS" --for=condition=Ready --timeout=120s
kubectl exec -n "$NS" photo-backup -- tar -C /data/photos -cf - . > "$BACKUP_DIR/photos.tar"
kubectl delete pod photo-backup -n "$NS" --wait=true
tar -tf "$BACKUP_DIR/photos.tar" >/dev/null
kubectl exec -i -n "$NS" "$primary" -c postgres -- pg_restore --list < "$BACKUP_DIR/cnpg.dump" >/dev/null
(cd "$BACKUP_DIR" && sha256sum *.dump photos.tar > SHA256SUMS && sha256sum -c SHA256SUMS)
```

Archive listing/checksums do not replace a restore rehearsal. Copy/encrypt the
backups off valtask and verify restoration before proceeding. If the window is
aborted, restore the original writer replica counts; no database cutover has
occurred. Do not restore Secrets or whole workload YAML blindly onto newer state.

### 2. Prepare the Citus-capable CNPG image

Keep writers stopped. From the clean checkout that CI packaged, render and
**server-dry-run** only the database overlay, then inspect the result. Applying it
is a separate approved operation: it updates images/configuration and restarts
instances, preserving their existing PVCs. Acknowledge the existing Kubernetes
1.37/CNPG support limitation separately; do not weaken the installer gate.

```bash
test "$(cat "$BACKUP_DIR/namespace")" = "$NS"
env_name="${NS#clichy-}"
release_sha="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)" || { echo 'Use a clean reviewed checkout'; exit 1; }
kubectl kustomize "infra/kubernetes/overlays/$env_name/database" |
  sed "s/REPLACE_WITH_TESTED_GIT_SHA/$release_sha/g" > "$BACKUP_DIR/database-target.yaml"
kubectl apply --dry-run=server -f "$BACKUP_DIR/database-target.yaml"
# Only after reviewing the dry-run and approving the rolling database update:
kubectl apply -f "$BACKUP_DIR/database-target.yaml"
kubectl wait -n "$NS" --for=condition=Ready cluster.postgresql.cnpg.io/clichy-postgres --timeout=900s
primary="$(kubectl get cluster.postgresql.cnpg.io clichy-postgres -n "$NS" -o 'jsonpath={.status.currentPrimary}')"
kubectl exec -n "$NS" "$primary" -c postgres -- psql -X -U postgres -d postgres -c "SHOW shared_preload_libraries; SELECT application_name,state FROM pg_stat_replication; SELECT rolname,rolsuper,rolreplication FROM pg_roles WHERE rolname='clichy';"
```

The last output must show Citus first, a streaming standby and a non-superuser/non-replication clichy role. Stop if those conditions differ; role changes are not automatic. Verify actual
operator-generated certificates and loopback authentication during restoration.
Do not proceed on an admission, image, preload or replication error.

### 3. Test: import without overwriting the old CNPG database

Create a new staging database; an existing name causes a safe stop. Restore the
**active Citus** archive as postgres, preserving object ownership and every Prisma
history row. The existing clichy role stays non-superuser; pg_dump does not restore
role attributes. Do not run Prisma migrations while the staging name is in use:
environment-guarded SQL must run only after the canonical name is restored.

First verify that the two existing namespace credentials agree, without displaying
them. A mismatch requires diagnosis before renaming databases or changing Secrets:

```bash
kubectl get secret clichy-server-secrets clichy-postgres-app -n clichy-test -o json |
python3 -c '
import base64,json,sys
from urllib.parse import urlsplit,unquote
items={x["metadata"]["name"]:x["data"] for x in json.load(sys.stdin)["items"]}
u=urlsplit(base64.b64decode(items["clichy-server-secrets"]["DATABASE_URL"]).decode())
p=base64.b64decode(items["clichy-postgres-app"]["password"]).decode()
assert u.username=="clichy" and unquote(u.password or "")==p, "Credential mismatch: stop; no values displayed"
print("PASS namespace credential consistency")'
```

```bash
test "$NS" = clichy-test
test "$(cat "$BACKUP_DIR/namespace")" = "$NS"
kubectl exec -n clichy-test "$primary" -c postgres -- createdb -U postgres -O clichy clichy_test_import
kubectl exec -n clichy-test "$primary" -c postgres -- psql -X -U postgres -d clichy_test_import -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION citus;'
kubectl exec -i -n clichy-test "$primary" -c postgres -- pg_restore -U postgres --exit-on-error -d clichy_test_import < "$BACKUP_DIR/active-citus.dump"
kubectl exec -n clichy-test "$primary" -c postgres -- psql -X -U postgres -d clichy_test_import -c 'SELECT count(*) FROM "Photo"; SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name;'
```

Compare counts, all migration rows (including the rolled-back attempt) and keys/FKs
with the source. A logical pg_dump restores ordinary tables and their rows, **not
Citus distribution catalogs**. Do not claim sharding is restored at this point:
the still-pending new migration will register the restored tables after the
canonical name switch. Original source tables/shards remain untouched. Retain the old Test CNPG database and
its one-row dataset under a different name. The following switch terminates
connections to both Test databases; no rows, tables or PVCs are dropped.

```bash
kubectl exec -i -n clichy-test "$primary" -c postgres -- psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_database WHERE datname='clichy_test_before_unify') THEN RAISE EXCEPTION 'Retained database name already exists; inspect first'; END IF; END $$;
ALTER DATABASE clichy_test ALLOW_CONNECTIONS false;
ALTER DATABASE clichy_test_import ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid,10000) FROM pg_stat_activity WHERE datname IN ('clichy_test','clichy_test_import');
ALTER DATABASE clichy_test RENAME TO clichy_test_before_unify;
ALTER DATABASE clichy_test_import RENAME TO clichy_test;
ALTER DATABASE clichy_test ALLOW_CONNECTIONS true;
SQL
```

Update only Test's Secret database hostname, preserving credentials and database
name. The JSON patch flows directly into kubectl; do not add shell tracing or
print intermediate values. Keep the protected Secret backup for rollback.

```bash
kubectl get secret clichy-server-secrets -n clichy-test -o json |
python3 -c '
import base64,json,sys
from urllib.parse import urlsplit,urlunsplit
s=json.load(sys.stdin); u=urlsplit(base64.b64decode(s["data"]["DATABASE_URL"]).decode())
assert u.scheme in ("postgres","postgresql") and u.hostname == "clichy-citus-rw" and u.path == "/clichy_test" and u.username == "clichy" and u.password is not None, "Unexpected source endpoint; stop"
credentials=u.netloc.rsplit("@",1)[0]
value=urlunsplit((u.scheme,credentials+"@clichy-postgres-rw:5432",u.path,u.query,u.fragment))
json.dump([{"op":"replace","path":"/data/DATABASE_URL","value":base64.b64encode(value.encode()).decode()}],sys.stdout)
' | kubectl patch secret clichy-server-secrets -n clichy-test --type=json --patch-file=/dev/stdin
./infra/kubernetes/scripts/migrate.sh test deploy
```

The new migration must now establish the 32 colocated shards without changing
row counts or prior history. The original Citus shard IDs need not be the IDs
allocated in this new logical copy. Once established, **WAL promotion** must
preserve the target's shard IDs; do not confuse these two kinds of transition.

### 4. Production: preserve the database and align its schema

Only after Test's checkpoints succeed, repeat backup/write-pause/image preparation
for NS=clichy-prod. Its endpoint already uses CNPG; no import or Secret host change
is needed. Existing-cluster bootstrap SQL is not rerun, so create the extension
explicitly, then apply the new additive migration as the non-superuser application
role through the existing helper:

```bash
test "$NS" = clichy-prod
test "$(cat "$BACKUP_DIR/namespace")" = "$NS"
kubectl exec -n clichy-prod "$primary" -c postgres -- psql -X -U postgres -d clichy_prod -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS citus;'
./infra/kubernetes/scripts/migrate.sh prod deploy
```

Production conversion takes table locks and redistributes rows into new logical
shards within its transaction. Downtime is intentional; no zero-downtime promise
is made. Null owners are backfilled; irreconcilable rows or unexpected node metadata
stop the migration. Do not mark it applied blindly or modify historical SQL.

### 5. Verify, resume and acknowledge

Restore the original writer replica counts (normally one each), then run the
healthcheck from this checkout. Test also needs an authenticated photo upload,
processing/thumbnail check, and a controlled CNPG switchover before Production.
The switchover command requires the official kubectl CNPG plugin and explicit
approval: it changes leadership, drops existing connections and may lose unreceived
async commits if treated as forced failover. Pause writes and verify catch-up first.

```bash
kubectl scale deployment/clichy-server deployment/clichy-worker -n "$NS" --replicas=1
./infra/kubernetes/scripts/healthcheck.sh "${NS#clichy-}"
# Approved Test-only controlled switchover, after replica catch-up:
kubectl get pods -n clichy-test -l cnpg.io/cluster=clichy-postgres -L cnpg.io/instanceRole
standby="$(kubectl get pods -n clichy-test -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=replica -o 'jsonpath={.items[0].metadata.name}')"
test -n "$standby"
kubectl cnpg promote clichy-postgres "$standby" -n clichy-test
kubectl wait -n clichy-test --for="jsonpath={.status.currentPrimary}=$standby" cluster.postgresql.cnpg.io/clichy-postgres --timeout=900s
kubectl wait -n clichy-test --for=condition=Ready cluster.postgresql.cnpg.io/clichy-postgres --timeout=900s
./infra/kubernetes/scripts/healthcheck.sh test
# Only after data/history, application and certificate checks pass:
kubectl annotate cluster.postgresql.cnpg.io clichy-postgres -n "$NS" \
  clichy.io/database-architecture=cnpg-citus-v1 --overwrite
```

Confirm primary name changed, the -rw Service follows it, shard IDs/row counts/FKs
are unchanged, streaming resumes, and reads/writes/processing work. Record the
actual evidence: the healthcheck does not perform this test. A controlled
switchover is not an automatic failure-recovery demonstration. Once acknowledged,
rerun the failed Test deployment job. Production remains a separate manual action.

After **successful, operator-confirmed Test cutover**, retire the old standalone
Deployment/Service and remove `infra/kubernetes/citus` from the active repository.
Those four files are currently retained for rollback and are no longer referenced
by normal deployment. Do not remove its PVC, the retained Test database or backups.
No automatic pruning is enabled. After that explicit checkpoint, cluster cleanup
can remove only the two obsolete resources (never `kubectl delete -k`, which would
also delete the PVC):

```bash
kubectl delete deployment/clichy-citus service/clichy-citus-rw -n clichy-test
```

Repository cleanup is a subsequent reviewed source change, after the operator
confirms migration/rollback validation; do not edit the clean server checkout in
place or delete the retained claim.


## Rollback

Before schema conversion, an error means stop and inspect; preserve all backups
and original connection details. If a rename step is interrupted, inspect the
existing names and ALLOW_CONNECTIONS flags before enabling the intended database.

A failed transactional migration rolls back its DDL/data changes, but Prisma may
record a failed attempt. Diagnose first; use Prisma resolve only for the specific
inspected failure, not an old hard-coded repair.

Before new writes resume, Test can restore its original endpoint without touching
CNPG data: `kubectl apply -f "$BACKUP_DIR/app-secret.json"`, keep/restart the old
Citus Deployment, restore writer counts and remove the acknowledgement with
`kubectl annotate cluster.postgresql.cnpg.io clichy-postgres -n clichy-test clichy.io/database-architecture-`.

After committed Production DDL, retain the Citus-capable image. Restore cnpg.dump
into a **new** database (created with owner clichy) using the same createdb/pg_restore
steps above, verify it, pause writers, and perform the same two-database name switch
from postgres, retaining the failed target under a different unused name. Do not
use --clean, delete PVCs or downgrade to an image missing Citus while Citus databases
remain. After any post-cutover writes, restoring an older snapshot would lose
those writes: reconcile them before choosing rollback. The photos archive belongs
to the same backup point; never overwrite live photo storage blindly.

For a Production restore rollback, keep writers at zero and choose unused names:

```bash
NS=clichy-prod
primary="$(kubectl get cluster.postgresql.cnpg.io clichy-postgres -n "$NS" -o 'jsonpath={.status.currentPrimary}')"
kubectl exec -n "$NS" "$primary" -c postgres -- createdb -U postgres -O clichy clichy_prod_restore
kubectl exec -i -n "$NS" "$primary" -c postgres -- pg_restore -U postgres --exit-on-error -d clichy_prod_restore < "$BACKUP_DIR/cnpg.dump"
# Verify restored counts, keys and migration history BEFORE the name switch.
kubectl exec -i -n "$NS" "$primary" -c postgres -- psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_database WHERE datname='clichy_prod_after_failed_unify') THEN RAISE EXCEPTION 'Retained name exists; inspect first'; END IF; END $$;
ALTER DATABASE clichy_prod ALLOW_CONNECTIONS false;
ALTER DATABASE clichy_prod_restore ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid,10000) FROM pg_stat_activity WHERE datname IN ('clichy_prod','clichy_prod_restore');
ALTER DATABASE clichy_prod RENAME TO clichy_prod_after_failed_unify;
ALTER DATABASE clichy_prod_restore RENAME TO clichy_prod;
ALTER DATABASE clichy_prod ALLOW_CONNECTIONS true;
SQL
kubectl annotate cluster.postgresql.cnpg.io clichy-postgres -n "$NS" clichy.io/database-architecture-
# Restore the original writer counts only after validating the restored database.
```

### Logical backups taken after unification

A post-cutover archive already records migration 20261117140000 as applied, yet
still does not contain Citus distribution catalogs. A plain restore followed by
`migrate deploy` alone is therefore insufficient. On a **restored, isolated copy**
with its canonical database name, after reviewing the archived schema/version,
replay the same immutable migration SQL explicitly to reconstruct/validate layout
without rewriting Prisma history:

```bash
# State-changing restore recovery, not routine deployment or healthchecking.
# NS, primary and db must identify the reviewed restored copy, with writers paused.
kubectl exec -i -n "$NS" "$primary" -c postgres -- psql -X -U postgres -d "$db" -v ON_ERROR_STOP=1   < packages/db/prisma/migrations/20261117140000_unified_cnpg_citus/migration.sql
```

Verify counts, FKs, ownership, migration history and sharding before resuming.
This uses the existing versioned SQL, not a second registration script. Never
replay an old layout against a newer schema without review. Physical backups
preserve catalogs and shard IDs; a production CNPG backup/recovery provider and
its restore rehearsal remain operational work, not an automation delivered here.
