# Monitoring and scaling

## Prometheus and Grafana

`infra/kubernetes/scripts/install-monitoring.sh` installs `kube-prometheus-stack` chart version `93.1.1` by default into namespace `monitoring`. It creates/uses a Grafana admin Secret, persistent Grafana and Prometheus storage, seven-day Prometheus retention, kube-state-metrics, node-exporter, and Alertmanager.

`infra/kubernetes/monitoring/service-monitor.yaml` scrapes server `/metrics` every 30 seconds in `clichy-dev` and `clichy-test`; it does not include Prod. Server registers application metrics in `apps/server/src/metrics.ts`. `cnpg-pod-monitor.yaml` selects the CNPG metric endpoint in Dev, Test, and Prod, including PostgreSQL replication role/lag metrics. The Grafana dashboard includes CNPG role, replica lag, streaming replica and WAL receiver panels; Prometheus rules alert for disconnected replicas and sustained lag. Live scrape health, panel import and alert behavior remain to be verified after the operator is installed.

Useful checks:

```bash
kubectl get pods,servicemonitors,podmonitors,prometheusrules -n monitoring
kubectl get servicemonitor clichy-server -n monitoring -o yaml
kubectl get podmonitor clichy-postgres -n monitoring -o yaml
kubectl get pods -n monitoring -o wide
```

## Scaling

Test has CPU HPAs for server and web, target 70% average CPU utilization, minimum one and maximum four replicas. No HPA exists for worker, Redis, or PostgreSQL. HPA needs functioning resource metrics and CPU requests; manifests provide requests, but metrics-server availability is not established by an HPA YAML alone.

```bash
kubectl get hpa -n clichy-test
kubectl describe hpa clichy-server -n clichy-test
kubectl top pods -n clichy-test
kubectl scale deployment/clichy-worker --replicas=2 -n clichy-test
kubectl rollout status deployment/clichy-worker -n clichy-test
```

Manual scaling examples change live cluster state. Review capacity, shared volume access, and queue behavior first. CNPG's replica count must be changed through its `Cluster` resource rather than scaling generated Pods/StatefulSets; in the one-node prototype, extra PostgreSQL instances increase CPU, memory, disk and I/O consumption without node fault tolerance. Redis remains a single instance.

Troubleshoot HPA with `kubectl describe hpa`, `kubectl get apiservice v1beta1.metrics.k8s.io`, `kubectl top nodes`, and Pod CPU requests. Headlamp's service account receives read-only access to CNPG Cluster resources and workload status; its mapping is useful for Kubernetes health and role visibility, while Prometheus/Grafana provide time-series application and database telemetry. Confirm the installed Headlamp version exposes the CNPG custom resource in its UI.
