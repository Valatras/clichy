# Roadmap and development status

The entries distinguish repository configuration from live behavior. Production CNPG is deployed on `valtask`; the Cluster was observed Ready with two instances and application DB connectivity has been restored. A direct replication-state query and failover exercise are still outstanding. Dev/Test live status should be checked separately.

| Stage | Status | Remaining work |
|---|---|---|
| 1. Foundation | Base application and environment setup exist | Verify onboarding and environment preparation after CNPG setup. |
| 2. Authentication and Storage | Better Auth, Prisma, photo storage, and fresh CNPG Production DB are in use | Verify fresh uploads and processing on the live environments; prototype DB contents were intentionally not imported. |
| 3. Image Processing | Processing and duplicate-comparison foundations exist | Exercise complete upload, processing and comparison workflow live. |
| 4. Containerization | Web/API/worker images and local DB/Redis Compose exist | Continue validating exact-SHA image pipeline. |
| 5. Kubernetes Deployment | Production CNPG Cluster is Ready and application DB connectivity is restored; Dev/Test live status and full traffic checks need evidence | Verify all namespace deployments, application traffic, storage, and the complete promotion path. |
| 6. Asynchronous Processing | Redis/BullMQ workers, retries, outbox and recovery logic exist | Verify queue, shared photo volume and worker recovery in Test. |
| 7. Infrastructure and deployment improvements | In progress; CNPG is deployed in Production | Capture PostgreSQL streaming status and controlled Test failover evidence, verify Prometheus targets/panels and Headlamp coverage, and demonstrate zero-downtime rollout and Prod promotion. Assignment gaps remain: sharding, Test refresh/anonymization, Redis replication and backup/restore. |
| 8. Paused | On hold | No work planned. |
| 9. Paused | On hold | No work planned. |

Git history shows the progression through image processing, Redis/BullMQ, K3s, monitoring, and deployment stability. Stage 7 is therefore in progress, not complete: cluster operation and final evaluation evidence are still outstanding. The installer targets K3s 1.37; CNPG 1.30.1 has only tested (not officially supported) Kubernetes 1.37 compatibility. See [the replication guide](../database/replication.md).

Production's request path is Cloudflare reverse proxy for both `valtask.xyz` and `www.valtask.xyz`, then Cloudflare Tunnel (`cloudflared`) to Traefik before a request reaches the Clichy Services. Tunnel and DNS configuration live outside this repository.
