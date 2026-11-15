# Assignment requirements traceability

Statuses describe repository evidence at `master` (`2a7717f`), not an independent evaluation demo. “Implemented, not verified” means configuration or code is present but its operation was not observed in this review.

| Requirement | Status | Evidence and gap |
|---|---|---|
| Unit tests after push | Implemented, not verified | `.github/workflows/ci.yml` runs type checks, server and worker tests, then builds on pushes and PRs to `master`. |
| Automatic deployment to Test after successful tests | Implemented, not verified | `deploy-test` follows CI and image packaging; self-hosted runner and cluster are required. |
| Promote to Production after validation | Partially implemented | Production waits for Test deployment and uses GitHub `production` Environment. Workflow has no explicit validation job; environment protection/approval depends on GitHub settings, which are not versioned. |
| Zero-downtime deployment | Not verified | Deployments use Kubernetes rolling update defaults, but each environment sets one replica. No demonstrated availability test or rollout evidence is versioned. |
| Database sharding | Not implemented | One PostgreSQL StatefulSet, one replica. Citus is not part of current manifests or package dependencies. |
| Database replication | Not implemented | No standby, replication slots, operator, or replication configuration found. One StatefulSet replica is not database replication. |
| Schema migrations | Implemented | Prisma migrations in `packages/db/prisma/migrations`; `migrate.sh` runs `prisma migrate deploy` before manifests. |
| Refresh Test from Production with anonymization | Not implemented | No dump/restore or anonymization procedure found. |
| Multiple application Pods | Partially implemented | Deployments can support replicas, but Dev/Prod overlay counts are one; Test HPA can scale web and server up to four if metrics are available. Worker stays one. |
| Replicated cache layer | Not implemented | One Redis Deployment, one replica, AOF persistence; no Redis replication/Sentinel/Cluster. |
| Single Ingress exposing application | Implemented | One Clichy Ingress routes `/api/auth`, `/photos` to server and `/` to web. Traefik is cluster ingress class. |
| Dashboard for system load and app health | Implemented, not verified | kube-prometheus-stack, Grafana dashboard JSON, API `/metrics`, Kubernetes alerts. Live scrape and dashboards not verified. |
| Manual or automatic scaling | Partially implemented | Kubernetes supports manual scale; Test HPA manifests target server/web CPU. Metrics API availability and actual HPA behavior are unverified. |
| Kubernetes rolling updates | Implemented, not verified | Kubernetes Deployments and rollout status checks in deploy script. No rollout demonstration evidence checked. |
| Migration during update | Implemented, not verified | Test and Prod jobs run migration before applying application manifests. |
| Local cluster setup | Documented scripts exist | `install-k3s.sh` targets Ubuntu 24.04; fresh install behavior not exercised here. |
| Cloud migration guide | Proposed in this site | Provider migration is a planning guide only; no cloud overlay exists. |
| CI/CD documentation | Implemented in this site | See [pipeline](../infrastructure/ci-cd.md). |
| Database documentation | Implemented in this site | See database section; backup procedures are absent from repository. |
| Monitoring/scaling documentation | Implemented in this site | See [monitoring](../infrastructure/monitoring.md). |
| Developer onboarding | Implemented in this site | Commands are cross-checked against scripts and package manifests; local execution has not been verified. |

## Evaluation notes

Key gaps for a demonstration are database replication and sharding, repeatable Test refresh with anonymization, proof of zero downtime, multi-replica application behavior, Redis availability, and a verified metrics/HPA path. Before marking configured features operational, capture workflow runs, cluster status, and a controlled rollout observation.
