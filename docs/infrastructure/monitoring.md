# Monitoring and scaling

## Prometheus and Grafana

`infra/kubernetes/scripts/install-monitoring.sh` installs `kube-prometheus-stack` chart version `93.1.1` by default into namespace `monitoring`. It creates/uses a Grafana admin Secret, persistent Grafana and Prometheus storage, seven-day Prometheus retention, kube-state-metrics, node-exporter, and Alertmanager.

`infra/kubernetes/monitoring/service-monitor.yaml` scrapes server `/metrics` every 30 seconds in `clichy-dev` and `clichy-test`; it does not include Prod. Server registers application metrics in `apps/server/src/metrics.ts`. Kubernetes resource/workload metrics are supplied by the monitoring stack. A Grafana dashboard JSON and Prometheus rules are checked in. Live scrape health and dashboard import were not verified during this review.

Useful checks:

```bash
kubectl get pods,servicemonitors,prometheusrules -n monitoring
kubectl get servicemonitor clichy-server -n monitoring -o yaml
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

Manual scaling examples change live cluster state. Review capacity, shared volume access, and queue behavior first. Avoid scaling PostgreSQL or Redis by changing replicas: their current manifests do not implement data replication or clustered coordination.

Troubleshoot HPA with `kubectl describe hpa`, `kubectl get apiservice v1beta1.metrics.k8s.io`, `kubectl top nodes`, and Pod CPU requests. Headlamp is an optional Kubernetes UI installed by dedicated scripts/RBAC; it is not application monitoring.
