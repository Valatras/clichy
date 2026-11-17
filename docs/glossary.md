# Glossary

Definitions describe the terms used in this project; implementation details
belong to their linked guides.

| Term | Meaning |
| --- | --- |
| API | HTTP interface used by clients; Clichy's Fastify service |
| Pod | Kubernetes scheduling unit containing one or more containers |
| Deployment | Controller rolling out a desired number of interchangeable Pods |
| ReplicaSet | Controller keeping a Pod replica count; managed by a Deployment |
| StatefulSet | Controller giving Pods stable identity and storage; the former database used one |
| Service | Stable cluster endpoint selecting backend Pods |
| ClusterIP | Service address reachable inside the cluster |
| Ingress | Host/path HTTP routing rules pointing to Services |
| Ingress Controller | Process implementing Ingress rules; Traefik here |
| Namespace | Logical scope for Kubernetes resources and access policies |
| ConfigMap | Non-secret configuration supplied to workloads |
| Secret | Kubernetes object for credentials; base64 encoding is not encryption |
| PV | PersistentVolume: cluster storage resource |
| PVC | PersistentVolumeClaim: request for storage bound to a PV |
| StorageClass | Storage provisioning policy used by PVCs |
| Retain | PV reclaim policy keeping storage after a claim is released; not a backup |
| Kustomize | Tool composing base manifests and environment overlays |
| Overlay | Environment-specific Kustomize customization |
| Helm | Package manager for parameterized Kubernetes charts |
| Rolling Update | Gradual replacement of Deployment Pods during a release |
| Readiness Probe | Check deciding whether a Pod should receive Service traffic |
| Liveness Probe | Check used to restart an unhealthy container |
| HPA | Horizontal Pod Autoscaler: adjusts replicas from observed metrics |
| Metrics Server | Supplies Kubernetes CPU/memory resource metrics for top/HPA |
| K3s | Lightweight Kubernetes distribution used on valtask |
| Traefik | Clichy's HTTP Ingress Controller |
| Cloudflare Tunnel | Outbound tunnel carrying public traffic to private Traefik |
| Tailscale | Private network used to reach Test and administration |
| CI/CD | Automated integration checks and delivery/deployment pipeline |
| Runner | Machine/process executing GitHub Actions jobs |
| GHCR | GitHub Container Registry, where application images are published |
| OCI image | Portable container image containing an application and runtime |
| SHA | Git commit identifier, embedded in immutable image tags |
| PostgreSQL | Relational database storing identity and photo metadata |
| Schema | Definition of tables, columns, keys and constraints |
| Migration | Ordered versioned SQL evolving a database schema |
| Prisma | TypeScript database toolkit and migration runner |
| Citus | PostgreSQL extension providing distributed and reference tables |
| Shard | Logical partition of distributed table rows |
| Distribution Key | Column used to route rows to shards; `userId` here |
| Colocation | Alignment of related tables' shard placement for compatible joins/FKs |
| Reference Table | Table replicated to Citus data nodes; the identity user table here |
| CNPG | CloudNativePG operator managing PostgreSQL Pods and replication |
| Primary | PostgreSQL instance accepting writes |
| Replica | Standby replaying changes from a primary |
| WAL | Write-ahead log recording database changes |
| Streaming Replication | Transfer and replay of WAL from primary to standby |
| Failover | Promotion/routing to a standby after primary failure |
| Cache | Stored copy speeding access; not a source of truth or backup |
| Queue | Work awaiting consumers; BullMQ manages Clichy's processing queue |
| Worker | Separate process consuming and executing jobs |
| Outbox | Transactional database events awaiting reliable queue publication |
| Redis | In-memory store backing BullMQ, with AOF persistence here |
| AOF | Append-only Redis persistence log; not replicated storage |
| BullMQ | Redis-backed Node job queue with retries and worker coordination |
| Prometheus | Time-series scraper/storage and alert-rule engine |
| Exporter | Endpoint translating component measurements into scrapeable metrics |
| ServiceMonitor | Prometheus Operator resource discovering Service metric endpoints |
| PodMonitor | Prometheus Operator resource discovering Pod metric endpoints |
| Grafana | Dashboard UI querying Prometheus |
| Headlamp | Private Kubernetes administration UI |
| Derivative | Generated preview image stored beside the original |
| pHash | Perceptual image fingerprint used for similarity comparisons |
| Hamming Distance | Number of differing bits between two hashes |
| Healthcheck | Read-only observation of current component state |
| Smoke Test | Small functional exercise; may write application data |
| Recovery | Deliberate state-changing procedure after diagnosis |

| Additional term | Meaning |
| --- | --- |
| Switchover | Controlled primary change while instances are available; distinct from failure recovery |
| mTLS | Both ends authenticate using TLS certificates; used for Citus loopback connections |
| Replication lag | WAL not yet received/replayed by the standby; relevant to asynchronous data loss |
