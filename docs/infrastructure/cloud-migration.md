# Cloud migration plan (not yet tested)

There is no cloud-specific overlay or validated provider deployment in the repository. This page is a planning checklist, not an executable runbook.

## Portable parts

Container images and tags, application Deployments, Services, Prisma migration model, queue contract, health endpoints, and most Kustomize structure are portable. The CI workflow can publish images to GHCR independent of runtime provider, but its self-hosted runner and kubeconfig currently target a host named `valtask` and enforce a single node.

## Provider-dependent work

| Area | Current assumption | Migration decision/work |
|---|---|---|
| Storage | Local PVs/node paths in Prod; local-path in other cluster | Choose CSI block/file storage, access modes, snapshots, encryption, reclaim behavior; migrate data and validate API/worker shared photo access. |
| PostgreSQL | In-cluster single StatefulSet and PVC | Decide managed database vs operator; update Secret/DNS/TLS/network policy; test restore and Prisma connectivity. |
| Redis | Single in-cluster Redis with PVC/AOF | Decide managed Redis or replicated service; update TLS/auth and availability behavior. |
| Ingress/load balancer | K3s Traefik, host-based rules | Choose managed LB/controller, configure health checks, public/private access, TLS and forwarding headers. |
| DNS | Local/LAN and existing hostname config | Set authoritative records and certificate issuance; validate auth callback/CORS origin. |
| Secrets | Kubernetes Secrets made by scripts | Move to cloud secret manager or sealed/external secret controller; rotate secrets and limit access. |
| Registry | GHCR | Configure cloud cluster pull access and image policy; keep immutable SHA references. |
| Monitoring | kube-prometheus-stack with PVCs | Size persistent metrics, retention, alert routing, egress and external monitoring needs. |
| Network | single-node K3s and ClusterIP services | Design subnets, firewall rules, egress, private DB access, and pod/service CIDRs. |
| Cost/sizing | small fixed resource requests/limits | Load test image processing and storage; size CPU, memory, IOPS, snapshots, egress and HA by measured demand. |

## Safe migration sequence to design

1. Select provider and decide managed vs in-cluster PostgreSQL/Redis.
2. Provision cluster, CSI storage, secrets integration, ingress, DNS and monitoring in a separate environment.
3. Build and push a pinned SHA image; apply schema migrations using a reviewed compatible migration.
4. Restore a sanitized Test dataset and verify auth, uploads, derivatives, queue recovery, metrics, and rollback procedure.
5. Plan photo file migration and database consistency checks; preserve originals and verify hashes.
6. Exercise failover, backup restore, rolling update and zero-downtime criteria before any production cutover.

These steps require environment-specific manifests and operational validation before becoming a production procedure.
