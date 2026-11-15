# Persistent storage

## Claims and paths

Base defines a 10 GiB PostgreSQL volume claim template, a 10 GiB photos PVC, and a 1 GiB Redis PVC. PostgreSQL and Redis data survive Pod replacement only if the claim is bound to durable storage. Dev/Test rely on cluster default storage class unless overridden. Production declares `clichy-prod-local` with `kubernetes.io/no-provisioner`, `WaitForFirstConsumer`, local PVs and node affinity to `valtask`.

The production local PV definitions specify host paths under `/srv/clichy/k3s-storage/prod/{postgres,photos,redis}` and `Retain` reclaim policy. The namespace preparation script checks `/srv/clichy` is mounted and prepares these directories. The known-issues record states current PVCs still use existing `local-path` storage at the time of that incident; current manifests now declare the production local StorageClass. This repository-level config and historical note differ in time, so inspect actual bound PVs before data operations.

The server and worker mount the photos claim at `/data/photos`. They must see the same files. Access mode is `ReadWriteOnce`; this is often node-scoped rather than multi-node shared storage, and does not establish safe cross-node scheduling. Production is explicitly tied to one node.

## Operational checks

```bash
kubectl get pvc,pv -n clichy-prod -o wide
kubectl describe pvc clichy-server-photos -n clichy-prod
kubectl describe statefulset clichy-postgres -n clichy-prod
```

No database backup/restore automation is present in the inspected repository. `Retain` prevents Kubernetes from automatically deleting PV data on claim release but is not a backup. See [backup and restore](../database/backup-restore.md).
