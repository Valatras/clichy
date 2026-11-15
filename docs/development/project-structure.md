# Project structure

| Path | Responsibility |
|---|---|
| `apps/web` | React Router UI |
| `apps/server` | Fastify API, photo storage and processing primitives, metrics, outbox dispatcher |
| `apps/worker` | BullMQ photo processing consumer and health listener |
| `packages/auth` | Better Auth configuration |
| `packages/db` | Prisma schema/client, migrations, local Postgres/Redis Compose |
| `packages/jobs` | Redis connection and BullMQ queue contracts/defaults |
| `packages/ui` | Shared UI components and styles |
| `packages/config` | Shared TypeScript configuration |
| `infra/docker_*` | Service Dockerfiles |
| `infra/kubernetes/base` | Shared Kubernetes resources |
| `infra/kubernetes/overlays` | Dev/Test/Prod Kustomize overlays |
| `infra/kubernetes/scripts` | Cluster, namespace, deployment, migration, monitoring and Headlamp scripts |
| `.github/workflows/ci.yml` | CI, GHCR packaging, Test and Production deploy jobs |
| `docs/` | MkDocs source plus existing design/operations documentation |

The root is a pnpm workspace coordinated by Turborepo. Package scripts are authoritative for runnable commands; consult `package.json` files before using a command not listed here.
