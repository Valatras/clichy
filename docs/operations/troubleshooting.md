# Troubleshooting

**What is it?** Diagnostics collect evidence about an unhealthy component.
Recovery changes state and must be planned from that evidence.

**Why Clichy uses it** A failed Pod, migration or queue should not lead to
unrelated changes, discarded data or a retry of an obsolete incident repair.

Start with `healthcheck.sh test|prod`, then inspect only the affected namespace:

```bash
kubectl config current-context
kubectl get deployments,pods,services,pvc,ingress -n clichy-test -o wide
kubectl get events -n clichy-test --sort-by=.lastTimestamp
kubectl logs deployment/clichy-server -n clichy-test --tail=100
kubectl logs deployment/clichy-worker -n clichy-test --tail=100
```

These reads may contain user data in logs; redact before sharing. Replace the
namespace deliberately for Production.

| Symptom | Investigate |
| --- | --- |
| Local client/types missing | `pnpm install`, `pnpm db:generate`, `pnpm env:generate`; verify Node/pnpm versions and environment schemas |
| Local DB/Redis refused | `docker compose ps` from `packages/db`; check 5432/6379 and the selected `.env` |
| Login fails | Auth URL, browser origin, secret length and cookies; API/Web host assumptions |
| Pod/PVC Pending | `kubectl describe pod` / `pvc`; StorageClass, free space, PV affinity, mounted paths and Production UID 26 |
| ImagePullBackOff | Exact SHA tag, image publication and namespace pull-secret presence/type; never print Secret values |
| API database failure | Both: CNPG+Citus, primary and `clichy-postgres-rw`; inspect endpoints and run migration status |
| Migration/layout failure | Read migration error and current catalogs; no reset, drop, automatic redistribution or blind resolve |
| Upload 400/413 | Supported format, 20 MiB upload cap and 40-million-pixel decoder limit |
| Photo remains PENDING/PROCESSING | Worker `/ready` probe/logs, Redis, queue name, outbox rows, common storage; allow documented stale-recovery intervals |
| Missing thumbnail | Owner, completed state and same original/derivative filesystem for API/worker |
| Empty Grafana panel | Prometheus targets and ServiceMonitor/PodMonitor discovery before assuming no traffic |
| HPA `<unknown>` | `kubectl top pods -n clichy-test`, Metrics APIService, HPA events and CPU requests; Prometheus is separate |
| Public/private URL unavailable | DNS/Host header, tunnel for Prod, Traefik entrypoint/class, Service endpoints and firewall |

For CNPG inspect `kubectl describe cluster clichy-postgres -n clichy-prod` and
operator logs in `cnpg-system`. For Citus inspect the primary's logs, extension/preload and pg_dist_partition /
pg_dist_shard metadata. Loopback authentication failures during COPY need the
CNPG certificate mapping, not a trust rule. Before cutover the legacy Test sources
are distinct; follow the [runbook](deployment.md#controlled-cutover).

A missing streaming standby does not by itself justify deleting a Pod or PVC.
An incorrect historical Citus registration needs an inspected data-preserving
migration plan. The old empty-table repair and hard-coded Prisma resolve mode
are removed; Git history retains their context. Do not revive them as a generic
repair. Verify coordinated database/photo backups before any state-changing
recovery. No tested turnkey restore or automatic rollback exists.

For runner failures, inspect its GitHub Online/Idle state and service logs
(`sudo journalctl -u 'actions.runner*' --since '30 minutes ago'`), then verify
its actual account can access the configured kubeconfig and tools.
