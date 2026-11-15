# Troubleshooting

Start with namespace and context checks to avoid inspecting the wrong cluster:

```bash
kubectl config current-context
kubectl get nodes
kubectl get deployments,pods,services,endpoints,pvc,ingress -n clichy-test -o wide
kubectl get events -n clichy-test --sort-by=.lastTimestamp
```

| Symptom | Checks |
|---|---|
| Pod pending / PVC pending | `kubectl describe pod`, `kubectl describe pvc`; verify StorageClass, local PV node affinity and node path. |
| ImagePullBackOff | Check image tag and `ghcr-pull-secret` exists in the workload namespace; never display its data. |
| API can't connect PostgreSQL | Check PostgreSQL Pod readiness/logs, Service endpoints, `DATABASE_URL` Secret presence/key name, and namespace match. Use `migrate.sh <env> status` for a protocol-aware DB check. |
| Migration fails | Read workflow/script output and PostgreSQL logs; run migration status; do not reset DB or remove PVC. |
| Upload returns 400/413 | Check supported format and 20 MiB multipart cap; image decoder also caps at 40 million pixels. |
| Photo stays pending | Inspect worker readiness/logs, Redis connectivity, queue name, outbox rows and photo storage mount. The worker Deployment has no Kubernetes probe despite exposing port 3001. |
| Thumbnail missing | Confirm photo belongs to user, processing completed, derivative exists on shared volume, and API/worker mount same PVC. |
| HPA has unknown metrics | Inspect HPA events, metrics APIService, `kubectl top pods`, CPU requests and monitoring separately. Prometheus does not itself guarantee the Kubernetes resource metrics API required by HPA. |
| Ingress unavailable | Verify host DNS, Traefik, Ingress class/entrypoint, Service endpoints and whether TLS is configured for that host. |

For logs: `kubectl logs deployment/clichy-server -n clichy-test`, `kubectl logs deployment/clichy-worker -n clichy-test`, and `kubectl logs statefulset/clichy-postgres -n clichy-test`. Use production namespace only with appropriate access and redact user data/secrets from any shared diagnostic output.
