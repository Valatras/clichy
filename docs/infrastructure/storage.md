# Persistent storage

## Claims and paths

CNPG creates two independent 2 GiB PostgreSQL PVCs per environment, one per instance. Dev/Test use the cluster's `local-path` class. Production declares two pre-bound 2 GiB PVs under `/srv/clichy/k3s-storage/prod/postgres-cnpg-{1,2}`, using `clichy-prod-local`, `Retain` and node affinity to `valtask`. The legacy 10 GiB PostgreSQL PV and directory remain reserved for the old StatefulSet until manual cutover validation; they are not used by CNPG. The photos PVC remains 10 GiB and Redis 1 GiB.

The namespace preparation script checks `/srv/clichy` is mounted and creates the two new CNPG paths only when empty, owned by UID/GID 26. It does not alter the legacy database path. The supplied `valtask` report shows 28 GiB available on this 30 GiB filesystem; two logical 2 GiB PVC capacities do not reserve filesystem blocks, so monitor actual host and PVC usage as data grows. A full filesystem can stop both instances at once.

The server and worker mount the photos claim at `/data/photos`. They must see the same files. Access mode is `ReadWriteOnce`; this is often node-scoped rather than multi-node shared storage, and does not establish safe cross-node scheduling. Production is explicitly tied to one node.

## Operational checks

```bash
kubectl get pvc,pv -n clichy-prod -o wide
kubectl describe pvc clichy-server-photos -n clichy-prod
kubectl get cluster,pods,pvc -n clichy-prod -o wide
kubectl describe pvc clichy-postgres-1 -n clichy-prod
```

No database backup/restore automation is present in the inspected repository. `Retain` prevents Kubernetes from automatically deleting PV data on claim release but is not a backup. See [backup and restore](../database/backup-restore.md).
