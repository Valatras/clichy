# Roadmap and development status

The entries distinguish repository configuration from live behavior. The CNPG manifests and scripts have not yet been applied to the home server.

| Stage | Status | Remaining work |
|---|---|---|
| 1. Foundation | Base application and environment setup exist | Verify onboarding and environment preparation after CNPG setup. |
| 2. Authentication and Storage | Better Auth, Prisma and photo storage implemented; DB is being replaced with fresh CNPG clusters | Run schema migrations, verify authentication and new uploads; prototype DB contents are intentionally not imported. |
| 3. Image Processing | Processing and duplicate-comparison foundations exist | Exercise complete upload, processing and comparison workflow live. |
| 4. Containerization | Web/API/worker images and local DB/Redis Compose exist | Continue validating exact-SHA image pipeline. |
| 5. Kubernetes Deployment | K3s, Kustomize overlays, Ingress, PV and CI deployment scripts exist | Install operator, create CNPG clusters, run migrations, verify app and external traffic. |
| 6. Asynchronous Processing | Redis/BullMQ workers, retries, outbox and recovery logic exist | Verify queue, shared photo volume and worker recovery in Test. |
| 7. Infrastructure and deployment improvements | Partially configured | Complete CNPG deployment/replication/failover verification, Prometheus scraping and Headlamp view, zero-downtime rollout evidence, Prod promotion validation. Assignment gaps remain: sharding, Test refresh/anonymization, Redis replication and backup/restore. |
| 8. Paused | On hold | No work planned. |
| 9. Paused | On hold | No work planned. |

Git history shows the progression through image processing, Redis/BullMQ, K3s, monitoring, and deployment stability. Stage 7 is therefore in progress, not complete: cluster operation and final evaluation evidence are still outstanding. The installer targets K3s 1.37; CNPG 1.30.1 has only tested (not officially supported) Kubernetes 1.37 compatibility. See [the replication guide](../database/replication.md).

Production's request path is Cloudflare reverse proxy for both `valtask.xyz` and `www.valtask.xyz`, then Cloudflare Tunnel (`cloudflared`) to Traefik before a request reaches the Clichy Services. Tunnel and DNS configuration live outside this repository.
