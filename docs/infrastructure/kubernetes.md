# Kubernetes implementation

Kustomize base resources are under `infra/kubernetes/base`; environment overlays are under `infra/kubernetes/overlays/{dev,test,prod}`. Common resources include web/API/worker Deployments, Services, Redis Deployment/Service/PVC, photo PVC, Ingress, and an environment-specific CNPG Cluster. Install the pinned CNPG operator once in `cnpg-system` before preparing any application namespace.

## Workload behavior

- API and web use readiness/liveness HTTP checks on `/`; worker has `/ready` and `/live` probes on port 3001.
- CNPG runs two PostgreSQL 18.6 instances per namespace and provisions a separate 2 GiB PVC per instance. Dev and Production applications use `clichy-postgres-rw`. Test also runs a single-node Citus database with its own PVC; the Test application uses `clichy-citus-rw` for user-sharded photo tables while CNPG remains available for replication exercises.
- Redis uses a one-replica Deployment, AOF, `noeviction`, 256 MiB maxmemory, probes, and a PVC.
- API, worker, web and database have CPU/memory requests and limits in base manifests.
- Test adds CPU HPA for API and web (1–4 replicas, 70% utilization target). Dev and Production specify one replica for web/server/worker. Production does not include this HPA.
- The namespace preparation script applies each CNPG Cluster and waits for its Ready condition. The deploy script waits for the database Cluster to be Ready before migrations, then applies app manifests and waits for each app Deployment rollout.

Kubernetes Deployment rollout is not itself proof of zero downtime. One-replica app workloads, storage attachment, readiness behavior, schema compatibility, and live traffic need a measured rollout test. CNPG's two replicas share the one `valtask` node and do not provide host-level HA.

## Environment differences

Dev uses `clichy.localhost`, development `NODE_ENV`, and local image names. Test uses `clichy-test.home.arpa`, GHCR images, hardened app security context, image pull secret, and HPA. Production uses `valtask.xyz`, exact SHA image tags, hardened contexts, production secrets, local PVs and one replica. All share the base architecture while namespaces and Secrets isolate resources.

Render without applying to inspect an overlay:

```bash
kubectl kustomize infra/kubernetes/overlays/test
```

This requires `kubectl` with Kustomize support. Do not apply a rendered overlay until its namespace, secrets, image references, storage, and target cluster are reviewed.
