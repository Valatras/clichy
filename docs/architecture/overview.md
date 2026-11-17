# System architecture

## Current deployment view

```mermaid
flowchart TB
  User[Browser] -->|HTTPS valtask.xyz or www.valtask.xyz| Proxy[Cloudflare reverse proxy]
  Proxy -->|routes canonical valtask.xyz requests| Tunnel[cloudflared tunnel]
  Proxy -. www redirects to canonical valtask.xyz .-> User
  Tunnel -->|HTTP to Traefik web :80| Traefik[Traefik Ingress]
  subgraph AppNS[Clichy-prod namespace]
    Traefik -->|/| Web[web Deployment]
    Traefik -->|/api/auth and /photos| API[server Deployment]
    API -->|Prisma via clichy-postgres-rw| PG[CNPG primary]
    PG -->|asynchronous WAL streaming| PGReplica[CNPG standby]
    PG --> PGV1[(Primary PVC)]
    PGReplica --> PGV2[(Standby PVC)]
    API -->|BullMQ| Redis[(Redis Deployment, 1 replica + AOF PVC)]
    API -->|original + derivative files| Photos[(photos PVC)]
    API -. DB outbox dispatcher .-> Redis
    Worker[worker Deployment] --> Redis
    Worker --> PG
    Worker --> Photos
  end
  Prom[Prometheus in monitoring namespace] -. /metrics .-> API
  Prom -. CNPG exporter .-> PG
  Grafana[Grafana] --> Prom
```

The public Production request path begins at Cloudflare, which is the reverse proxy for both `valtask.xyz` and `www.valtask.xyz`. HTTPS terminates there; `cloudflared` forwards the requests through the tunnel as HTTP to Traefik's `web` entrypoint on port 80. Cloudflare redirects `www.valtask.xyz` to canonical `valtask.xyz`; the application Ingress host is `valtask.xyz`. Tunnel, DNS and redirect rules are configured outside this repository. Traefik then routes the UI and API paths to their in-cluster Services.

The server is both the HTTP API and outbox dispatcher. It constructs the BullMQ queue and periodically dispatches pending outbox entries. Worker instances consume `process-photo` jobs. The API and worker need the same photo files; Kubernetes mounts the photos PVC into both Deployments.

## Namespace interpretation

The repository defines `clichy-dev`, `clichy-test`, and `clichy-prod`; monitoring and Headlamp are separate cluster-level installations/namespaces. These are namespace boundaries on one cluster, not separate clusters. Each environment overlay defines an independent two-instance CNPG database cluster and independent application Secrets; Redis remains a separate Deployment.

## Limits

The repository configures one server, web, and worker replica by default (Test has an HPA for server/web), one Redis instance, and two PostgreSQL instances per namespace. CNPG replication, failover, and metrics are configured but remain unverified until applied on the live cluster. Test application metadata uses a separate Citus Pod with 32 colocated hash shards on `userId`; its CNPG cluster remains separate for replication exercises. Dev and Production connect directly to CNPG. Both database instances and their independent node-local volumes remain on the same physical host; this does not provide node-level availability. The old Production PostgreSQL PV is retained during migration.
