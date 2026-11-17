# Assignment requirements traceability

Statuses distinguish repository configuration from observed live behavior. Production CNPG was observed Ready with two instances and application database connectivity restored; direct streaming-state and failover evidence is still outstanding. Dev/Test live state is not asserted here.

| Requirement | Status | Evidence and gap |
|---|---|---|
| Unit tests after push | Implemented, not verified | `.github/workflows/ci.yml` runs type checks, server and worker tests, then builds on pushes and PRs to `master`. |
| Automatic deployment to Test after successful tests | Implemented, not verified | `deploy-test` follows CI and image packaging; self-hosted runner and cluster are required. |
| Promote to Production after validation | Partially implemented | Production waits for Test deployment and uses GitHub `production` Environment. Workflow has no explicit validation job; environment protection/approval depends on GitHub settings, which are not versioned. |
| Zero-downtime deployment | Not verified | Deployments use Kubernetes rolling update defaults, but each environment sets one replica. No demonstrated availability test or rollout evidence is versioned. |
| Database sharding | Not implemented / deferred | CNPG supplies a single logical PostgreSQL cluster per environment; no shard key, routing, or Citus. Sharding remains an explicit assignment gap and a separate design decision. |
| Database replication | Production deployed; Cluster healthy; streaming/failover not fully evidenced | Pinned CNPG 1.30.1 operator and two-instance async PostgreSQL 18.6 Cluster are configured with separate PVCs and role Services. Production was observed Ready with both instances running. Capture `pg_stat_replication` and a controlled Test failover/recovery before claiming those behaviors verified. |
| Schema migrations | Configured, live execution pending | Prisma migrations in `packages/db/prisma/migrations`; `migrate.sh` now targets CNPG `-rw`, and deploy waits for CNPG Ready before running `prisma migrate deploy`. |
| Refresh Test from Production with anonymization | Not implemented | No dump/restore or anonymization procedure found; current app Secret/envs remain isolated, but no refresh job exists. |
| Multiple application Pods | Partially implemented | Deployments can support replicas, but Dev/Prod overlay counts are one; Test HPA can scale web and server up to four if metrics are available. Worker stays one. |
| Replicated cache layer | Not implemented | One Redis Deployment, one replica, AOF persistence; no Redis replication/Sentinel/Cluster. |
| Single Ingress exposing application | Implemented | One Clichy Ingress routes `/api/auth`, `/photos` to server and `/` to web. Traefik is cluster ingress class. |
| Dashboard for system load and app health | Configured, not verified | kube-prometheus-stack, Grafana dashboard JSON, API/worker `/metrics`, HTTP/outbox/BullMQ metrics, Kubernetes alerts and CNPG PodMonitor panels are defined. Live scrapes, alert evaluation and dashboard import still need valtask evidence. |
| Manual or automatic scaling | Partially implemented | Kubernetes supports manual scale; Test HPA manifests target server/web CPU. Metrics API availability and actual HPA behavior are unverified. Headlamp CNPG Cluster visibility is read-only in RBAC, pending live UI confirmation. |
| Kubernetes rolling updates | Implemented, not verified | Kubernetes Deployments and rollout status checks in deploy script. No rollout demonstration evidence checked. |
| Migration during update | Implemented, not verified | Test and Prod jobs run migration before applying application manifests. |
| Local cluster setup | Documented scripts exist | `install-k3s.sh` targets Ubuntu 24.04; fresh install behavior not exercised here. |
| Cloud migration guide | Proposed in this site | Provider migration is a planning guide only; no cloud overlay exists. |
| CI/CD documentation | Implemented in this site | See [pipeline](../infrastructure/ci-cd.md). |
| Database documentation | Implemented in this site | See database section; backup procedures are absent from repository. |
| Monitoring/scaling documentation | Implemented in this site | See [monitoring](../infrastructure/monitoring.md). |
| Developer onboarding | Implemented in this site | Commands are cross-checked against scripts and package manifests; local execution has not been verified. |

## Evaluation notes

Key gaps for a demonstration are direct verification of CNPG WAL streaming and failover, the assignment's still-missing database sharding, repeatable Test refresh with anonymization, proof of zero downtime, multi-replica application behavior, Redis availability, and a verified metrics/HPA path. CNPG 1.30 officially supports Kubernetes 1.34–1.36; 1.37 is tested but not officially supported, which matters because the repository's K3s installer targets 1.37. Before marking configured features operational, capture workflow runs, cluster status, Prometheus targets, Headlamp visibility, and a controlled rollout observation.
