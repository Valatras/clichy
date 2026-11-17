# Scripts & Commands

**What is it?** These are the supported operational entry points and their
side effects. Commands assume the repository root and an explicitly selected
kubeconfig; scripts never make choosing the correct environment unnecessary.

**Why Clichy uses it** Routine observations, installation, deployment and load
testing should have clear responsibilities and predictable impact.

## Public scripts

Paths below `scripts/` are relative to `infra/kubernetes/`.

| Script / command | Purpose | Environment | Impact |
| --- | --- | --- | --- |
| `scripts/install-k3s.sh` | Install K3s; prepare operator kubeconfig | New Ubuntu 24.04 host | Changes host/services; confirms install |
| `scripts/install-helm.sh` | Install Helm with checked APT configuration | Ubuntu/Debian | Changes host packages; confirms |
| `cnpg/install-operator.sh` | Install pinned CNPG operator | Cluster | Applies CRDs/operator after compatibility checks |
| `scripts/prepare-namespace.sh dev\|test\|prod` | Prepare Secrets, storage paths and databases | Local Dev / valtask Test/Prod | Changes namespace and local secret files; confirms |
| `scripts/configure-lan-access.sh` | Set Traefik private admin entrypoints | valtask | Changes cluster networking; confirms, rejects conflicts |
| `scripts/install-monitoring.sh` | Install Prometheus/Grafana | Cluster | Helm/Secrets/manifests; confirms; existing release needs explicit upgrade flag |
| `scripts/install-headlamp.sh` | Install private Headlamp | Cluster | Helm/manifests/RBAC; confirms |
| `scripts/deploy.sh test\|prod sha-<40-hex>` | Migrate then roll out matching images | Test/Prod | Changes database/workloads; confirms |
| `scripts/migrate.sh test\|prod deploy` | Apply pending Prisma migrations | Test/Prod | Changes database |
| `scripts/migrate.sh test\|prod status` | Full Prisma history diagnostic | Test/Prod | Database reads; Secret access and temporary loopback port-forward |
| `scripts/healthcheck.sh test\|prod [--verbose]` | Observe environment invariants | Test/Prod | Read-only Kubernetes/SQL/HTTP/Redis observations |
| `scripts/load-test-test.sh server\|web 300 32` | Bounded scaling demonstration | Test only | HTTP load and temporary port-forward; confirms |
| `pnpm --filter server backfill:photos` | Reschedule incomplete library processing | Configured API environment | Changes database/queue; build first; review target |

Bash/Node test files are internal checks, not admin commands. Baseline host APT
setup is documented directly in [Kubernetes setup](../infrastructure/kubernetes.md),
without a separate wrapper. No active script performs the old empty-table repair.

Database image preparation is explicit; application deployment is blocked until
the [cutover acknowledgement](deployment.md#normal-operation-after-cutover) exists.

## Healthchecks

```bash
./infra/kubernetes/scripts/healthcheck.sh test
./infra/kubernetes/scripts/healthcheck.sh prod
./infra/kubernetes/scripts/healthcheck.sh test --verbose
```

Requires Bash, kubectl and GNU `timeout` (Ubuntu coreutils). No local database
client or pnpm is needed. Kubernetes read/exec permissions are required; Secrets
and connection strings are not fetched. Use the checkout whose migration names
you expect in the environment. The script keeps the current context unchanged.

| Scope | Checks |
| --- | --- |
| Both | Namespace, available Web/API/worker/Redis, PVCs, Redis PING, internal API HTTP, expected CNPG endpoint and a read-only SQL probe from the API Pod using its own credentials |
| Both databases | Two ready CNPG instances, primary/replica, connectivity, non-privileged app role, Citus extension/preload, local coordinator, hash(userId), 32 colocated shards per table, compound primary keys, validated FKs, migration history and active streaming |
| Failover | Explicit SKIP: requires an approved state-changing exercise |

Each kubectl operation is bounded by a 10-second request and 25-second outer
limit; rollout/wait is 15 seconds. SQL forces read-only mode and a 10-second
statement timeout. Total runtime is the sum of checks. Raw command errors are
suppressed even in verbose mode to avoid disclosure; verbose prints target scope.
For detailed investigation use [troubleshooting](troubleshooting.md).

Example (abbreviated, not a live observation):

```text
PASS Kubernetes namespace access
PASS Citus reference table, hash(userId), 32 shards and colocation
WARN Migration checks compare names only; checksum drift requires Prisma migrate status
Summary: PASS=31 WARN=1 FAIL=0 SKIP=1
```

Exit `0`: no failed checks (warnings/skips allowed). Exit `1`: failed check or
missing dependency. Exit `2`: invalid arguments. Missing required components fail.
Migration-name comparison does not prove checksum equality or detect all extra
history; use `migrate.sh <env> status` for Prisma's full comparison.

Internal HTTP is called from an API Pod; deployment probes cover Web/worker.
This does not test public ingress, authentication, uploads, storage writes or
job completion. Before the controlled cutover, the new target checks correctly
fail on the old split topology rather than pretending it is unified.
Healthchecks never apply resources, run migrations, delete data or repair state.
