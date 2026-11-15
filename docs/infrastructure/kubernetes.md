# Kubernetes implementation

Kustomize base resources are under `infra/kubernetes/base`; environment overlays are under `infra/kubernetes/overlays/{dev,test,prod}`. Common resources include web/API/worker Deployments, Services, PostgreSQL StatefulSet/Service, Redis Deployment/Service/PVC, photo PVC, and Ingress.

## Workload behavior

- API and web use readiness/liveness HTTP checks on `/`; worker health listener is on 3001 but the Deployment currently has no probe configured.
- PostgreSQL uses a one-replica StatefulSet and a 10 GiB claim template.
- Redis uses a one-replica Deployment, AOF, `noeviction`, 256 MiB maxmemory, probes, and a PVC.
- API, worker, web and database have CPU/memory requests and limits in base manifests.
- Test adds CPU HPA for API and web (1–4 replicas, 70% utilization target). Dev and Production specify one replica for web/server/worker. Production does not include this HPA.
- Deploy script applies manifests and waits for each app Deployment rollout, but does not explicitly check StatefulSet or HPA convergence.

Kubernetes Deployment rollout is not itself proof of zero downtime. One-replica app workloads, storage attachment, readiness behavior, schema compatibility, and live traffic need a measured rollout test.

## Environment differences

Dev uses `clichy.localhost`, development `NODE_ENV`, and local image names. Test uses `clichy-test.home.arpa`, GHCR images, hardened app security context, image pull secret, and HPA. Production uses `valtask.xyz`, exact SHA image tags, hardened contexts, production secrets, local PVs and one replica. All share the base architecture while namespaces and Secrets isolate resources.

Render without applying to inspect an overlay:

```bash
kubectl kustomize infra/kubernetes/overlays/test
```

This requires `kubectl` with Kustomize support. Do not apply a rendered overlay until its namespace, secrets, image references, storage, and target cluster are reviewed.
