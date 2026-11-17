# Monitoring and scaling

## Prometheus, Grafana, and alerts

`infra/kubernetes/scripts/install-monitoring.sh` installs the pinned `kube-prometheus-stack` chart in namespace `monitoring`. It provides Prometheus, Grafana, Alertmanager, kube-state-metrics, node-exporter and the Kubernetes resource metrics API through Metrics Server. Prometheus retains seven days of metrics. Grafana's sidecar imports the versioned **Clichy Photo Service** dashboard from the labelled ConfigMap.

Prometheus discovers three application metric sources:

- `ServiceMonitor/clichy-server` scrapes the API `/metrics` endpoint every 30 seconds in Dev, Test and Prod. It includes HTTP request rate, status, duration and active-request metrics, plus the number of unpublished PostgreSQL outbox events.
- `PodMonitor/clichy-worker` scrapes worker `/metrics` every 15 seconds in all three namespaces. It exports BullMQ counts by state, completed-job and failed-attempt rates, job duration, and whether the queue metrics query is succeeding.
- `PodMonitor/clichy-postgres` scrapes CNPG's PostgreSQL metrics port in all three namespaces.

The PrometheusRules alert on replica WAL/lag issues, worker/outbox backlogs, missing worker metric scrapes, restarts, unavailable deployments, image/crash backoff, sustained CPU/memory use, low PVC space and Test HPAs that remain at their replica ceiling. Alert rules and dashboard queries consume collected metrics; they do not make a missing scrape work. Verify actual targets and series after each monitoring or worker change.

From `valtask`, inspect configuration and target resources:

```sh
kubectl get pods,services -n monitoring -o wide
kubectl get servicemonitors,podmonitors,prometheusrules -n monitoring
kubectl get servicemonitor clichy-server -n monitoring -o yaml
kubectl get podmonitor clichy-worker -n monitoring -o yaml
kubectl get podmonitor clichy-postgres -n monitoring -o yaml
kubectl get prometheusrule clichy-alerts -n monitoring -o yaml
```

In Grafana at `http://valtask:3000`, open **Clichy Photo Service**, choose `clichy-test`, and check HTTP rate/p95, worker queue state, outbox backlog, HPA desired/current replicas, CPU and memory, PVC capacity and PostgreSQL replication panels. In Prometheus, check **Status → Targets** for the API, worker and both CNPG Pods. A missing target or empty panel is not evidence that the workload is idle until scrape health is confirmed.

The API and worker image changes must first be deployed to Test so the new `/metrics` series exist. The ordinary Test workflow applies `infra/kubernetes/monitoring`; it does not reinstall or upgrade the Helm release. Do not run `install-monitoring.sh` as a routine apply: if the Helm release already exists, the installer requires an explicit reviewed upgrade.

## HPA behavior

Test has CPU HPAs for `clichy-server` and `clichy-web`, target 70% of the requested CPU, minimum one and maximum four replicas. The request is 100m CPU for each container, so a 70% target corresponds to 70m average usage per Pod. The HPA requires working Metrics Server data and CPU requests. Prometheus metrics alone do not supply the `metrics.k8s.io` API used by HPA.

The worker has no HPA. Redis and CNPG are also not HPA-scaled. Do not manually scale a Deployment that has an HPA attached; the controller will reconcile its replica count. A worker is suitable for the manual scaling demonstration because it has no HPA:

```sh
NS=clichy-test
kubectl scale deployment/clichy-worker -n "$NS" --replicas=2
kubectl rollout status deployment/clichy-worker -n "$NS" --timeout=180s
kubectl get deployment clichy-worker -n "$NS" -o wide
kubectl get pods -n "$NS" -l app=clichy-worker -o wide

# Restore the configured Test count after recording the demonstration.
kubectl scale deployment/clichy-worker -n "$NS" --replicas=1
kubectl rollout status deployment/clichy-worker -n "$NS" --timeout=180s
```

This temporarily increases CPU/memory use and consumers of the shared photos PVC. Check `kubectl top nodes` first and restore one replica after recording the result.

## Reproducible Test load

First confirm that Metrics Server works and both HPAs have valid metrics:

```sh
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
kubectl top pods -n clichy-test
kubectl get hpa -n clichy-test -o wide
kubectl describe hpa clichy-server -n clichy-test
kubectl describe hpa clichy-web -n clichy-test
```

If HPA metrics show `<unknown>`, fix Metrics Server or the Pod CPU request before generating load. Then run the repository script from `valtask` in an interactive terminal:

```sh
./infra/kubernetes/scripts/load-test-test.sh server 300 32
```

The script verifies the current context is the single-node `valtask`, displays current resource use, asks before starting, and port-forwards to the Test API. It sends read-only unauthenticated `GET /photos` requests (expected response: 401), so it does not upload photos or create records. The request driver runs on `valtask`, outside the application Pod cgroups. To drive the web HPA instead, use:

```sh
./infra/kubernetes/scripts/load-test-test.sh web 300 32
```

Use a second terminal while the load runs:

```sh
kubectl get hpa -n clichy-test -w
kubectl get deployments,pods -n clichy-test -o wide
kubectl top pods -n clichy-test
```

Capture HPA current/desired replicas, CPU utilization, Pod readiness and Grafana HTTP rate/CPU panels. The HPA and Metrics Server sampling delays mean scaling may take a minute or more. If the selected HPA remains at one replica and CPU stays below target, stop the run and increase concurrency or duration within the script limits; never run this generator against Prod. After the load ends, keep watching until HPA returns to one replica.

If metrics are unavailable, inspect HPA events and requests:

```sh
kubectl describe hpa clichy-server -n clichy-test
kubectl get apiservice v1beta1.metrics.k8s.io -o wide
kubectl top nodes
kubectl top pods -n clichy-test
kubectl get deployment clichy-server -n clichy-test \
  -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{" cpu-request="}{.resources.requests.cpu}{"\n"}{end}'
```

One-node scaling demonstrates Kubernetes replica behavior; it does not add host-level availability or capacity beyond the resources of `valtask`.
