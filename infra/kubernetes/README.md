# Clichy Kubernetes administration, autoscaling, and monitoring

This repository manages the Clichy application with Kustomize. The existing
`prometheus-stack` Helm release is installed separately in `monitoring`; this
directory adds Clichy dashboards, rules, and scrape configuration without
reinstalling or changing that release. The empty
[`monitoring/values.yaml`](./monitoring/values.yaml) is not an authoritative
Helm values file.

## Select the native K3s cluster

The commands below target the native K3s cluster, not Docker Desktop
Kubernetes. In each terminal session, select the K3s kubeconfig before running
`kubectl` or `helm` commands:

```bash
export KUBECONFIG="$HOME/.kube/config-k3s"
kubectl config current-context
```

If you instead use the default Docker Desktop kubeconfig, TLS verification can
fail because its API address (`kubernetes.docker.internal`) does not match the
certificate served by the native K3s API. Do not work around this by disabling
certificate verification.

## Headlamp

Headlamp is installed from the official `headlamp/headlamp` Helm chart, pinned
to chart version `0.46.0`. Its chart values and namespace-scoped RBAC are
versioned in [`headlamp/`](./headlamp/).
For step-by-step UI access, scaling, and troubleshooting, see the
[administrator Headlamp guide](./administrator_headlamp_guide.md).

Install or upgrade it on the K3s host using the K3s kubeconfig:

```bash
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
helm repo update headlamp
kubectl apply -k infra/kubernetes/headlamp
helm upgrade --install headlamp headlamp/headlamp \
  --namespace headlamp \
  --version 0.46.0 \
  --values infra/kubernetes/headlamp/values.yaml \
  --wait
kubectl get service headlamp -n headlamp
```

The chart uses a single replica, a ClusterIP Service on port 80, and the
repository's `headlamp` ServiceAccount. The chart's default cluster-admin
ClusterRoleBinding is disabled. Start a local-only tunnel:

```bash
kubectl port-forward -n headlamp svc/headlamp 4466:80
```

Open [http://localhost:4466](http://localhost:4466). `kubectl port-forward`
binds to localhost by default; do not use `--address 0.0.0.0` or expose this
Service through a public Ingress.

If Headlamp asks for a bearer token, mint a short-lived token for its
ServiceAccount from a terminal using the K3s kubeconfig selected above:

```bash
kubectl create token headlamp -n headlamp --duration=1h
```

Paste the printed token into Headlamp. It grants the permissions described
below; treat it as a credential and do not share it.

### Headlamp identity and permissions

Headlamp runs in-cluster and creates a `main` context from its pod's
ServiceAccount. The chart's `config.unsafeUseServiceAccountToken: false`
setting is retained, so it does not force every login to use that account;
however, it does not create a distinct Kubernetes identity per browser. Any
user who uses the in-cluster `main` context exercises the shared ServiceAccount
permissions. Treat this single-user, port-forwarded instance as access to those
permissions. Do not share the tunnel or expose the UI to untrusted users. For
multi-user use, configure a real OIDC identity provider and validate that each
user's Kubernetes requests are authorized as that user, or deploy separate
instances with isolated identities.

The ServiceAccount is bound to the built-in Kubernetes `admin` ClusterRole
only within `clichy-dev` and `clichy-test`. It can manage namespaced resources
there, including Secrets, workloads, HPAs, and Pod exec.

Headlamp also has cluster-wide **read-only** access to Pods, Services, Events,
Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, HPAs,
their Pod metrics, namespace names, and Node objects and usage metrics. This
is needed by Headlamp's aggregate Overview and Workloads pages, which list
resources cluster-wide before applying the UI namespace filter. Kubernetes
RBAC cannot limit those cluster-wide list requests to only the two Clichy
namespaces, so metadata for these resource types in other namespaces is also
visible. This does not grant access to Secret contents outside the Clichy
namespaces, Pod logs/exec outside them, or permission to modify workloads,
Nodes, or RBAC outside the two Clichy namespaces. The ServiceAccount is not
bound to `cluster-admin`.

This is full administrative access to the two Clichy namespaces, not a
read-only view. Anyone holding a Headlamp session or token can access Secrets
and modify or delete resources in those namespaces. Keep the interface
port-forward-only and tokens private. The aggregate UI can display the
cluster-wide workload metadata listed above, but this does not provide
administrative access to `monitoring` or other namespaces.

To scale a manually managed Dev Deployment, open **Workloads → Deployments**,
select `clichy-dev`, open `clichy-web` or `clichy-server`, and use the scale
control to set replicas. Test Deployments are HPA-managed, so manual replica
changes there are temporary and will be reconciled by the HPA.

## Autoscaling

Dev keeps fixed replicas in its overlay (`server: 1`, `web: 2`). Prod also
keeps explicit fixed counts. The common Deployment templates do not set
`spec.replicas`; this prevents them from overriding the Test HPAs.

Test has two `autoscaling/v2` HPAs, one each for `clichy-server` and
`clichy-web`, with minimum 1, maximum 4, and 70% average CPU utilization.
The existing per-container requests are `100m` CPU and `128Mi` memory; limits
are `500m` CPU and `512Mi` memory. At the HPA target, each pod is aimed at
roughly `70m` average CPU. The 4-replica upper bound limits the two application
Deployments to 8 replicas; PostgreSQL remains a single StatefulSet and is never
autoscaled. At the maximum, app requests total `800m` CPU and `1Gi` memory;
limits cap aggregate app usage at `4` CPU cores and `4Gi` memory. Limits are
ceilings rather than reservations, but the node's memory headroom should still
be watched while demonstrating scale-out. Lower the HPA maximum if the laptop
shows memory pressure.

Kubernetes Metrics Server supplies the Resource Metrics API used by the CPU
HPA. Prometheus is separate: it scrapes time-series data for dashboards and
alerts. A Prometheus Adapter is not needed for CPU-based HPA.

Inspect scaling and resource metrics:

```bash
kubectl get hpa -n clichy-test
kubectl describe hpa -n clichy-test clichy-server
kubectl describe hpa -n clichy-test clichy-web
kubectl top pods -n clichy-test
kubectl get deployment -n clichy-test
```

`TARGETS` should show a CPU percentage rather than `<unknown>`. If it does not,
check `kubectl top pods -n clichy-test`, container CPU requests, and
`kubectl describe hpa`.

The Test GitHub Actions deployment keeps replica ownership with the HPA. It
updates the client-side last-applied configuration for existing app
Deployments from the replica-free base templates before applying the Test
overlay; this migrates existing Deployments without treating HPA-selected
replicas as desired Git state. The image update and rollout checks remain
unchanged.

## Database schema migrations

The Test deployment workflow runs `prisma migrate deploy` against the Test
PostgreSQL Service before applying the app rollout. It reads `DATABASE_URL`
from the existing Kubernetes Secret into the migration process and uses a
localhost-only port-forward; it does not print the value. Add schema changes
as committed Prisma migrations. Do not use `prisma db push` or `migrate reset`
for persistent Dev/Test data.

Dev is not deployed by that workflow. After adding a migration, apply it to
Dev explicitly. One option is to port-forward its database and run Prisma using
the Dev Secret URL rewritten to the local forwarded port:

```bash
kubectl port-forward --address 127.0.0.1 \
  -n clichy-dev service/clichy-postgres 25432:5432
```

In another terminal at the repository root, with the K3s kubeconfig selected:

```bash
DATABASE_URL="$(kubectl get secret clichy-server-secrets \
  -n clichy-dev -o json |
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const secret = JSON.parse(input);
      const url = new URL(
        Buffer.from(secret.data.DATABASE_URL, "base64").toString(),
      );
      url.hostname = "127.0.0.1";
      url.port = "25432";
      process.stdout.write(url.toString());
    });
  ')"
export DATABASE_URL
pnpm --filter @clichy/db exec prisma migrate deploy
unset DATABASE_URL
```

The Test Secret's `DATABASE_URL` was corrected in the live cluster to match
its existing PostgreSQL credentials and database. When managing Secret
manifests, use either valid base64 under `data` or plaintext under
`stringData`; do not put base64-encoded values in `stringData`.

## Prometheus and Grafana

### Where collection and display are configured

The flow is **exporter/application → ServiceMonitor → Prometheus → Grafana**:

1. Kubernetes components expose their own metrics. The installed
   `kube-prometheus-stack` release configures Prometheus to scrape Kubernetes
   and node exporters (such as kube-state-metrics and kubelet/cAdvisor).
2. The Server implements application metrics in
   [`apps/server/src/metrics.ts`](../../apps/server/src/metrics.ts). Its
   `/metrics` endpoint is selected by
   [`monitoring/service-monitor.yaml`](./monitoring/service-monitor.yaml):
   that resource tells Prometheus which namespaces and labeled Service to
   scrape, which named port/path to request, and how often.
3. Prometheus Operator discovers ServiceMonitors and PrometheusRules whose
   `release: prometheus-stack` label matches the installed Prometheus
   resource's selectors. The Clichy rule expressions in
   [`monitoring/prometheus-rule.yaml`](./monitoring/prometheus-rule.yaml)
   evaluate already-collected time series and create alerts; they do not
   configure scraping.
4. The dashboard JSON in
   [`monitoring/clichy-dashboard.json`](./monitoring/clichy-dashboard.json)
   contains PromQL queries. Kustomize places it in a ConfigMap labeled
   `grafana_dashboard=1`; the installed Grafana sidecar imports it, and Grafana
   runs those queries against Prometheus when displaying panels.

Headlamp is separate: it reads current Kubernetes API resources and, where
available, Metrics Server's resource metrics. It does not query Prometheus or
display the Clichy Grafana dashboard. Metrics Server supplies CPU/memory
resource metrics for `kubectl top` and CPU-based HPA; Prometheus stores
time-series for Grafana dashboards and alert evaluation.

The monitoring Kustomize package is applied by the existing Test deployment
workflow and can also be applied manually:

```bash
kubectl apply -k infra/kubernetes/monitoring
kubectl get servicemonitor,prometheusrule -n monitoring
```

It creates:

- A dashboard ConfigMap labeled `grafana_dashboard=1`, discovered by the
  kube-prometheus-stack Grafana dashboard sidecar when that sidecar is enabled
  and watches the `monitoring` namespace.
- A `ServiceMonitor` selecting the Clichy Server Service in Dev and Test,
  scraping its internal `/metrics` path every 30 seconds.
- Prometheus alert rules labeled for the existing `prometheus-stack` release.

The Server's `/metrics` endpoint is not routed by the public Clichy Ingress.
The existing Server ClusterIP Service exposes the scrape port only inside the
cluster. App metrics contain method, matched route template, and status code;
they never include user IDs, photo IDs, raw URLs, or other request values.

The **Clichy Photo Service** Grafana dashboard has a Dev/Test namespace
selector and panels for running Pods, desired/available replicas, CPU and
memory by namespace and Pod, restarts, unavailable replicas, HPA current and
desired replicas, HPA CPU utilization versus target, PVC capacity/free space,
HTTP request rate, p95 request latency, and active requests.

Access Grafana with the existing port-forward:

```bash
kubectl port-forward -n monitoring svc/prometheus-stack-grafana 3000:80
```

Open [http://localhost:3000](http://localhost:3000), then select the
**Clichy Photo Service** dashboard. Inspect alerts in Prometheus at
`http://localhost:9090/alerts` and Alertmanager at `http://localhost:9093`.
These are the Services verified in the installed `prometheus-stack` release:

```bash
kubectl port-forward -n monitoring svc/prometheus-stack-kube-prom-prometheus 9090:9090
kubectl port-forward -n monitoring svc/prometheus-stack-kube-prom-alertmanager 9093:9093
```

To confirm the rules and targets loaded:

```bash
kubectl get prometheusrule,servicemonitor -n monitoring
kubectl get pods -n monitoring
```

In the Prometheus UI, check **Status → Targets** for the `clichy-server`
ServiceMonitor and **Alerts** for the `Clichy` rules. Metrics Server powers HPA
but does not feed Prometheus automatically. Prometheus scrape targets provide
Grafana and Prometheus data; the two metric paths have different consumers.

The dashboard and rules use kube-state-metrics workload/HPA metrics and
kubelet container/PVC metrics, plus the Clichy Server's own counters and
histogram. The workload, HPA, container, restart, waiting-reason, and PVC
metric families were verified in the current K3s Prometheus, and Prometheus
parsed all seven alert expressions and all dashboard queries. The dashboard
sidecar also discovered and reloaded the Clichy ConfigMap.

The current cluster's Server image predates the `/metrics` endpoint. Its
Dev and Test ServiceMonitor targets are discovered but currently return HTTP
404 because both Server images predate the `/metrics` endpoint. The existing
GitHub Actions workflow deploys Test only, so Test targets become healthy after
the next successful `master` deployment. To enable app-level panels for Dev as
well, deploy that same published image tag to Dev:

```bash
IMAGE_TAG=sha-REPLACE_WITH_COMMIT_SHA
kubectl set image deployment/clichy-server \
  server="ghcr.io/valatras/clichy-server:${IMAGE_TAG}" \
  --namespace=clichy-dev
kubectl rollout status deployment/clichy-server \
  --namespace=clichy-dev --timeout=180s
unset IMAGE_TAG
```

Confirm the `clichy-server` targets are **UP** in Prometheus after each
environment rollout. If PVC panels are empty later, verify kubelet volume
metrics for local-path volumes; HPA target metric series were verified after
creating the Test HPAs.

The repository does not manage or reinstall `prometheus-stack`. Before relying
on the dashboard ConfigMap discovery, verify the existing release's values:

```bash
helm get values prometheus-stack -n monitoring
helm get values prometheus-stack -n monitoring --all |
  grep -A8 -B2 'sidecar:'
```

If needed, enable the existing Grafana dashboard sidecar and ensure its
`grafana_dashboard=1` label selector watches `monitoring`; preserve the rest of
the release values when upgrading.

## Demonstrating autoscaling

Use the Test Web Deployment for a load test; it is stateless and has no
database write side effects. Keep the port-forward and load generator on the
K3s host. In one terminal:

```bash
kubectl port-forward -n clichy-test svc/clichy-web 8080:80
```

In another terminal, generate a bounded burst of local HTTP requests (adjust
duration if the laptop becomes resource constrained):

```bash
for i in $(seq 1 3000); do
  curl --silent --output /dev/null http://127.0.0.1:8080/ &
  if (( i % 50 == 0 )); then wait; fi
done
wait
```

Watch `kubectl get hpa -n clichy-test --watch` and
`kubectl get pods -n clichy-test --watch`, then stop the load. A single
short-lived burst may not exceed the HPA's averaging window; sustained
CPU-intensive requests are needed to demonstrate scaling reliably. Avoid
load-testing Server endpoints that create or modify application data.

## Troubleshooting

- HPA shows `<unknown>`: check Metrics Server (`kubectl top pods -n
  clichy-test`), requests, and HPA events.
- HPA does not scale: inspect `kubectl describe hpa`; CPU must remain above
  target long enough for the metrics/control loop to react.
- Grafana panels are empty: check Prometheus targets, the datasource, the
  dashboard sidecar labels, and run the panel query in Explore.
- Fastify metrics are absent: inspect `ServiceMonitor`, the `clichy-server`
  Service's named `http` port, `/metrics` from an in-cluster Pod, and Prometheus
  target health. Do not add a public Ingress route for `/metrics`.
- Alerts do not appear: inspect the Prometheus `Clichy` rule group and check
  Prometheus's rule selectors. Alertmanager only shows alerts that are firing.
- Do not troubleshoot by deleting PVCs, PVs, or application namespaces.
