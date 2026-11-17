# Redis, monitoring and scaling

## Redis and BullMQ

**What is it?** Redis stores in-memory data with optional persistence; BullMQ
uses Redis to coordinate queued jobs, retries and worker delivery.

**Why Clichy uses it** Image processing runs outside the API request lifecycle.
The PostgreSQL outbox keeps unpublished work durable when Redis is unavailable.

Each namespace has one Redis Deployment, AOF and a 1 GiB PVC, with `noeviction`
and a 256 MiB memory budget. It is internal, not a replicated cache. Queue
names/credentials must agree between API and worker. See the
[photo lifecycle](../architecture/application.md) for recovery and retry semantics.

## Prometheus and Grafana

**What is it?** Prometheus scrapes time-series metrics and evaluates rules;
Grafana displays them. Exporters expose measurements; ServiceMonitor/PodMonitor
resources tell Prometheus where to scrape.

**Why Clichy uses it** Operators need HTTP latency/error rate, queue backlog,
worker failures, disk capacity and PostgreSQL replication visibility.

`install-monitoring.sh` installs the pinned kube-prometheus-stack chart into
`monitoring`. Versioned Helm values, monitors, rules and the **Clichy Photo
Service** dashboard live under `infra/kubernetes/monitoring`. The ordinary
Test workflow applies monitoring manifests without upgrading Helm. Re-running
the installer for an existing release requires a reviewed explicit upgrade.

| Source | Discovery and useful signals |
| --- | --- |
| API `/metrics` | ServiceMonitor; HTTP rate/status/duration and unpublished outbox |
| Worker `/metrics` | PodMonitor; BullMQ state, attempts, duration and query health |
| CNPG metrics | PodMonitor; PostgreSQL WAL/replication |
| Node and Kubernetes exporters | CPU/memory, PVC usage, Pod restarts and availability |

Open private Grafana at `http://valtask:3000`, select the environment and inspect
the dashboard. Verify **Prometheus → Status → Targets** before interpreting an
empty panel as idle. Rules cover backlog, missing scrapes, unavailable workloads,
restarts, resource pressure, storage and HPA limits. Retention is seven days.
Headlamp at `http://valtask:4466` is optional private cluster administration.

## HPA and Metrics Server

**What is it?** HPA adjusts Deployment replica counts from observed metrics.
Metrics Server supplies the Kubernetes resource metrics API used for CPU scaling;
Prometheus is a separate monitoring system.

**Why Clichy uses it** Test Web/API can scale from one to four replicas at 70%
of requested CPU. Worker, Redis and databases do not have HPAs.

Verify `kubectl top pods -n clichy-test` and `kubectl get hpa -n clichy-test` before
load testing. An `<unknown>` metric needs investigation, not more load. For a
bounded, confirmed Test-only load demonstration:

```bash
./infra/kubernetes/scripts/load-test-test.sh server 300 32
# Or use web instead of server.
kubectl get hpa -n clichy-test -w
```

The generator uses unauthenticated reads (API 401 is expected), creates local
load and a temporary port-forward, and never uploads data. Observe sampling
delays and wait for scale-down afterwards. Do not manually scale HPA-controlled
Deployments. For a manual worker demonstration use `kubectl scale deployment/clichy-worker -n clichy-test --replicas=2`,
then restore `--replicas=1`; this changes cluster resource usage. Extra replicas
on one node do not add physical capacity or node-level availability.
