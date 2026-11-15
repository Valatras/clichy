# Prerequisites and configuration

## Toolchain

The root `package.json` pins `pnpm@12.8.1`; CI uses Node.js 24. The repository uses TypeScript, Turborepo, Varlock, Prisma, and Docker. Local database services are PostgreSQL 18 and Redis 7.4 from `packages/db/docker-compose.yml`. Docker Compose is needed for those services; Docker/Kubernetes are optional for app-only development.

Versions not pinned in repository metadata (for example, a local `kubectl` or `mkdocs`) must be selected by the operator. The K3s bootstrap script is specifically written for Ubuntu Server 24.04 and defaults to K3s `v1.37.2+k3s1`.

## Environment files

Schemas are in `apps/web/.env.schema`, `apps/server/.env.schema`, `apps/worker/.env.schema`, and `packages/db/.env.schema`. Root `postinstall` runs Varlock code generation. The server/worker require database and Redis connection settings; auth adds `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `CORS_ORIGIN`; web uses `VITE_SERVER_URL`.

| Variable | Consumer | Meaning/default evidence |
|---|---|---|
| `DATABASE_URL` | API, worker, Prisma | PostgreSQL URL; required by server/worker |
| `BETTER_AUTH_SECRET` | API | Required secret, schema min 32 characters |
| `BETTER_AUTH_URL` | API | Auth canonical URL |
| `CORS_ORIGIN` | API | Allowed browser origin |
| `PHOTO_STORAGE_PATH` | API/worker | Defaults in schemas to local data paths; Kubernetes sets `/data/photos` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB` | API/worker | Defaults in code to `127.0.0.1`, `6379`, `0` |
| `REDIS_PASSWORD`, `REDIS_TLS` | API/worker | Optional password and TLS toggle |
| `PHOTO_QUEUE_NAME` | API/worker | Defaults to `photo-processing` |
| `PHOTO_JOB_ATTEMPTS`, `PHOTO_JOB_BACKOFF_MS` | Queue | Defaults to 4 and 2000 ms |
| `PHOTO_WORKER_CONCURRENCY` | Worker | Default 1; code permits 1 or 2 |
| `VITE_SERVER_URL` | Web build | API base URL; currently build workflow supplies localhost URL |

Never commit `.env` files or real secrets. The deploy scripts create Kubernetes Secrets interactively; see [namespace setup](../infrastructure/namespaces.md).
