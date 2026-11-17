# Database replication status

## Current state

CloudNativePG (CNPG) is configured for two PostgreSQL 18.6 instances in each app namespace. In Production on `valtask`, the cluster has been observed Ready with two running instances, and the application database connection has been restored. The primary/standby roles and WAL streaming are configured, but the evidence collected so far does not include a live `pg_stat_replication` result or a failover test. Dev and Test live status should be checked separately.

The old PostgreSQL StatefulSet is no longer included in the environment overlays. Its existing production PV and data directory are retained and are not reused by CNPG. CNPG provisions one independent PVC per instance. Production uses two pre-bound, retained local PVs; Dev and Test use K3s `local-path` dynamic provisioning. The operator affinity retains preferred anti-affinity, allowing both instances on this one-node cluster while still preferring separation if nodes are added later.

## Architecture and WAL flow

```mermaid
flowchart LR
  App[API, worker, Prisma migrations] -->|TCP 5432| RW[CNPG -rw Service]
  RW --> Primary[Primary Pod: reads and writes]
  Primary -->|WAL stream, asynchronous| Standby[Standby Pod: recovery/read-only]
  Primary --> PVC1[(PVC: primary data)]
  Standby --> PVC2[(PVC: standby data)]
  Operator[CNPG operator] -. watches, repairs, promotes .-> Primary
  Operator -. watches, repairs, promotes .-> Standby
```

CNPG configures and supervises the PostgreSQL instances; PostgreSQL itself streams write-ahead log (WAL) records from the primary and replays them on the standby. Asynchronous replication is selected (`minSyncReplicas: 0`, `maxSyncReplicas: 0`): writes do not wait for standby acknowledgement, so a sudden primary loss can lose the most recent unreceived transactions. Synchronous replication waits for configured standbys and can reduce that loss window, but adds write latency and can block writes when acknowledgers are unavailable; it is not enabled here.

CNPG runs a controller in `cnpg-system`, exposes `clichy-postgres-rw` and read-only `-ro`/`-r` role services, and reconciles the cluster resource. The app uses only `-rw`; no replica read routing is configured. CNPG promotes an eligible standby after it determines the primary has failed, updates the role service, and recreates/rejoins the former primary as a standby when possible. A deliberate Pod deletion tests the controller's Pod failure recovery path, but it is not equivalent to loss of the node or a controlled PostgreSQL shutdown.

This single-node prototype does not protect against power, disk, OS, K3s, or physical server failure. Replication is not a backup: accidental deletes and logical corruption can be replayed. Keep backups and tested restore as separate work.

## Install and inspect

The pinned operator installer is `infra/kubernetes/cnpg/install-operator.sh`. CNPG 1.30.1 officially supports Kubernetes 1.34–1.36; its release is tested but not officially supported on 1.37. The project K3s installer currently targets 1.37, so check the live server version first. The script refuses 1.37 unless the operator explicitly opts in with `CNPG_ALLOW_TESTED_UNSUPPORTED_K8S=1`; K3s distribution support is also outside CNPG's formal vanilla-Kubernetes support policy. Do not interpret successful install as upstream support.

On `valtask`, from a clean checkout of this repository, check `kubectl version -o json` and `/srv/clichy` free space first. The supplied host report had 28 GiB free on that 30 GiB filesystem; the new two 2 GiB CNPG volumes are separate from the retained legacy volume. Then install the operator once:

```sh
# For Kubernetes 1.34–1.36:
./infra/kubernetes/cnpg/install-operator.sh

# Only if the actual server reports Kubernetes 1.37 and you accept the
# tested-but-not-supported status:
CNPG_ALLOW_TESTED_UNSUPPORTED_K8S=1 ./infra/kubernetes/cnpg/install-operator.sh
```

The installation creates the `cnpg-system` namespace, CRDs, RBAC and operator Deployment. Next, create fresh empty DB clusters and credentials; this prepares secrets, local PV directories for Prod, and CNPG resources, but does not remove or import legacy database contents:

```sh
./infra/kubernetes/scripts/prepare-namespace.sh test
./infra/kubernetes/scripts/prepare-namespace.sh dev
./infra/kubernetes/scripts/prepare-namespace.sh prod
```

Each script prompts before changing its namespace and may prompt for GHCR credentials if needed. The Prod run creates `/srv/clichy/k3s-storage/prod/postgres-cnpg-1` and `-2` only when absent/empty, sets UID/GID 26 on new paths, and retains `/srv/clichy/k3s-storage/prod/postgres`. Once Test is Ready, push the reviewed commit through the ordinary pipeline: CI runs tests/builds, deploys Test, and the configured Production environment gate controls Prod promotion. `deploy.sh` refuses to migrate or deploy until CNPG reports Ready.

After operator install and namespace preparation, inspect roles and PVCs:

```sh
kubectl get cluster,pods,svc,pvc -n clichy-prod -o wide
kubectl get pods -n clichy-prod -l cnpg.io/cluster=clichy-postgres -L cnpg.io/instanceRole
kubectl get endpointslice -n clichy-prod -l kubernetes.io/service-name=clichy-postgres-rw
kubectl describe cluster clichy-postgres -n clichy-prod
```

`kubectl cnpg status clichy-postgres -n clichy-prod` is also useful if the optional CNPG kubectl plugin is installed; it is not installed by the operator script.

Connect with `psql` using the in-cluster `clichy-postgres-rw` Service and the `clichy-postgres-app` credentials (do not put passwords directly in shell history). On the primary, inspect active senders:

```sql
SELECT application_name, state, sync_state, sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication;
```

On the standby, check recovery and WAL receive/replay positions:

```sql
SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
```

The primary should return `false` for `pg_is_in_recovery()` and list a streaming standby in `pg_stat_replication`. The standby should return `true`; receive/replay positions should advance after writes. `pg_stat_replication` is queried on the primary; it does not show the standby from itself.

For a quick live check on Production, query the primary from its Pod:

```sh
NS=clichy-prod
PRIMARY=$(kubectl get pod -n "$NS" \
  -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=primary \
  -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$PRIMARY" -- psql -U postgres -d postgres -c \
  "SELECT application_name, state, sync_state, sent_lsn, replay_lsn, \
   pg_size_pretty(pg_wal_lsn_diff(sent_lsn, replay_lsn)::bigint) AS byte_lag \
   FROM pg_stat_replication;"
```

Expect one row for the standby with `state = streaming` and `sync_state = async`. A `NULL` lag can occur when there is no recent WAL activity; the streaming state is the key check. This command reads status only and does not change the cluster.

## Demonstrate replication and failover (Test only)

Run these steps on `valtask` with the context explicitly set to the intended cluster. Every state-changing command below targets `clichy-test`; do not copy it with a Production namespace. Confirm the cluster is healthy and has exactly one primary and one replica before starting:

```sh
NS=clichy-test
kubectl config current-context
kubectl get cluster clichy-postgres -n "$NS" -o wide
kubectl get pods -n "$NS" -l cnpg.io/cluster=clichy-postgres -L cnpg.io/instanceRole -o wide
kubectl get pvc -n "$NS" -o wide
PRIMARY=$(kubectl get pod -n "$NS" -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=primary -o jsonpath='{.items[0].metadata.name}')
REPLICA=$(kubectl get pod -n "$NS" -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=replica -o jsonpath='{.items[0].metadata.name}')
test -n "$PRIMARY" && test -n "$REPLICA" && test "$PRIMARY" != "$REPLICA"
printf 'primary=%s replica=%s namespace=%s\n' "$PRIMARY" "$REPLICA" "$NS"
```

On the primary, verify its role and WAL sender. On the replica, verify recovery mode and receiver/replay positions:

```sh
kubectl exec -n "$NS" "$PRIMARY" -- psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_is_in_recovery();" \
  -c "SELECT application_name, state, sync_state, sent_lsn, replay_lsn FROM pg_stat_replication;"
kubectl exec -n "$NS" "$REPLICA" -- psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();"
```

The primary must report `false` and one sender in `streaming` state; the replica must report `true`. To prove replay, create a disposable marker on the primary and poll the read-only replica until asynchronous WAL replay catches up:

```sh
kubectl exec -n "$NS" "$PRIMARY" -- psql -U postgres -d clichy_test -v ON_ERROR_STOP=1 -c \
  "DROP TABLE IF EXISTS cnpg_replication_demo; CREATE TABLE cnpg_replication_demo (id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO cnpg_replication_demo VALUES (1, 'wal-check');"
for attempt in $(seq 1 30); do
  if kubectl exec -n "$NS" "$REPLICA" -- psql -U postgres -d clichy_test -Atqc \
    "SELECT marker FROM cnpg_replication_demo WHERE id = 1;" | grep -qx wal-check; then
    echo "WAL marker replayed on $REPLICA"
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "WAL marker did not appear on the replica within 30 seconds" >&2
    exit 1
  fi
  sleep 1
done
```

Wait until the replica returns the marker before switching; this avoids testing with an un-replayed asynchronous write. If the optional CNPG kubectl plugin is installed, request a planned switchover. The plugin is not installed by the repository's operator installer. If the command reports `unknown command "cnpg"`, skip this planned-switchover substep and continue with the automatic failover exercise below:

```sh
kubectl cnpg promote clichy-postgres "$REPLICA" -n "$NS"
kubectl wait --for=condition=Ready cluster.postgresql.cnpg.io/clichy-postgres \
  -n "$NS" --timeout=300s
kubectl get pods -n "$NS" -l cnpg.io/cluster=clichy-postgres -L cnpg.io/instanceRole -o wide
kubectl get endpointslice -n "$NS" -l kubernetes.io/service-name=clichy-postgres-rw -o wide
```

After a successful promote command, confirm that the former replica is now primary and that the `-rw` EndpointSlice points to it. For an actual Prisma CLI write through `clichy-postgres-rw`, open a loopback-only port-forward in Terminal A and leave it running while you execute the commands in Terminal B:

```sh
kubectl port-forward --address=127.0.0.1 -n clichy-test service/clichy-postgres-rw 15432:5432
```

In Terminal B, load the Test-only local secrets file created by `prepare-namespace.sh` (the commands do not print its contents), point Prisma at the local forwarded port, and create a uniquely named disposable table using Prisma:

```sh
set -a
source "$HOME/.config/clichy/test-secrets.env"
set +a
test "$(node -e 'console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))')" = clichy_test
DATABASE_URL="$(node -e '
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== "clichy-postgres-rw" || url.pathname !== "/clichy_test") process.exit(1);
  url.hostname = "127.0.0.1";
  url.port = "15432";
  url.searchParams.set("sslmode", "disable");
  process.stdout.write(url.toString());
')"
export DATABASE_URL
PSQL_URL="$(node -e '
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("schema");
  url.searchParams.set("sslmode", "disable");
  process.stdout.write(url.toString());
')"
export PSQL_URL
pnpm --filter @clichy/db exec prisma db execute --stdin <<'SQL'
CREATE TABLE cnpg_prisma_failover_demo (id integer PRIMARY KEY, marker text NOT NULL);
INSERT INTO cnpg_prisma_failover_demo VALUES (1, 'after-switchover');
SQL
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT * FROM cnpg_prisma_failover_demo ORDER BY id;"
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c \
  "DROP TABLE cnpg_prisma_failover_demo;"
unset DATABASE_URL PSQL_URL POSTGRES_PASSWORD
```

`prisma db execute` reads its datasource from `prisma.config.ts`; it does not accept `--schema`. `PSQL_URL` removes Prisma's `schema` query parameter because libpq rejects it. Both connections go through the `clichy-postgres-rw` port-forward. Prisma creates and inserts the row, then `psql` reads it back before cleanup. `./infra/kubernetes/scripts/migrate.sh test status` is an additional Prisma connectivity/migration check; it is read-only and does not prove a write. Stop Terminal A with Ctrl-C after Terminal B completes.

If the evaluation specifically requires automatic failover after primary loss, perform this exercise after the replication marker was observed and the cluster is healthy. If you also ran a planned switchover, first confirm that it completed and the cluster returned Ready. This deliberately deletes the current primary Pod in Test (never its PVC), so expect a short connection interruption:

```sh
PRIMARY=$(kubectl get pod -n clichy-test \
  -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=primary \
  -o jsonpath='{.items[0].metadata.name}')
test -n "$PRIMARY"
printf 'About to delete Test primary Pod %s in namespace clichy-test\n' "$PRIMARY"
kubectl delete pod "$PRIMARY" -n clichy-test
kubectl get pods -n clichy-test -l cnpg.io/cluster=clichy-postgres \
  -L cnpg.io/instanceRole -w
```

Stop the watch once both Pods are Ready and the role label has moved to the former replica. Then check the Cluster and `-rw` endpoint separately:

```sh
kubectl get cluster clichy-postgres -n clichy-test -o wide
kubectl get endpointslice -n clichy-test \
  -l kubernetes.io/service-name=clichy-postgres-rw -o wide
```

Re-run the recovery and sender checks above. Recompute `PRIMARY` and `REPLICA` from labels because CNPG may assign different instance names, then reopen the loopback port-forward and repeat the Prisma CLI write/read check above through `clichy-postgres-rw`. Remove the WAL marker from the current primary when finished:

```sh
PRIMARY=$(kubectl get pod -n clichy-test -l cnpg.io/cluster=clichy-postgres,cnpg.io/instanceRole=primary -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n clichy-test "$PRIMARY" -- psql -U postgres -d clichy_test -v ON_ERROR_STOP=1 -c \
  "DROP TABLE IF EXISTS cnpg_replication_demo;"
```

Pod deletion tests CNPG's automated response to primary Pod loss, but it does not simulate node-level HA and asynchronous replication can lose un-replayed transactions. Never delete either instance PVC. Do not perform either switchover or Pod deletion in Production for this demonstration.

## Retire the legacy StatefulSet after cutover

The Kustomize overlay no longer declares the legacy StatefulSet, but Kubernetes does not automatically delete resources removed from a manifest. Once the new application is verified in every environment, an operator can remove only the old StatefulSet and old Service:

```sh
kubectl delete statefulset clichy-postgres -n clichy-test
kubectl delete service clichy-postgres -n clichy-test
```

Repeat for Dev and Production only after checking the selected object and its namespace. Do not delete `data-clichy-postgres-0`, its PVC, the legacy PV, or the old directory as part of this step; retain them until intentionally cleaning up storage in a separately reviewed operation. CNPG's similarly named Cluster is `clusters.postgresql.cnpg.io/clichy-postgres`, not the old StatefulSet.

## Monitoring and Headlamp

CNPG exports PostgreSQL metrics on Pod port `metrics` (9187). `infra/kubernetes/monitoring/cnpg-pod-monitor.yaml` selects CNPG Pods in all three namespaces; the Prometheus Helm values select the PodMonitor. Grafana adds role/recovery, lag, streaming replica and WAL receiver panels, and Prometheus alerts for a disconnected replica and sustained lag. Headlamp receives read-only access to `clusters.postgresql.cnpg.io` so its mapping can display CNPG Cluster status alongside Pods, Services and PVCs. Verify actual scrape targets in Prometheus and the panels/alerts after installation; YAML alone does not prove telemetry is flowing.

## Storage and limits

Each instance has an independent 2 GiB PVC in this prototype. The production manifest binds to `/srv/clichy/k3s-storage/prod/postgres-cnpg-1` and `-2`; each path must be an empty directory owned by UID/GID 26 before first start. The supplied preparation script creates these paths without changing the legacy PostgreSQL directory. Two copies of the database consume about twice the data volume, plus WAL and filesystem overhead. The production paths share the existing 30 GiB `/srv/clichy` filesystem, so watch both PVC metrics and host free space. Dev/Test use dynamically provisioned local-path PVCs.

The operator can automatically recover a Pod or promote a standby, but the whole cluster remains on one K3s node. This design demonstrates the mechanics and does not provide host-level availability, geographic recovery, or a backup. Production and Test are separate PostgreSQL clusters with independent PVCs and Secrets; no Production-to-Test refresh/anonymization job is implemented.
