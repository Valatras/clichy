# Local setup

**What is it?** Local development runs the Web, API and worker as Node processes,
with PostgreSQL and Redis in Docker Compose. pnpm manages the workspace packages.

**Why Clichy uses it** Developers can work on the application without installing
Kubernetes or accessing valtask.

## Install

Use Node.js 24, pnpm 12.8.1, Git and Docker with Compose. From the repository root:

```bash
pnpm install
pnpm db:start
```

`pnpm install` generates Varlock environment types. Compose starts PostgreSQL 18
and Redis 7.4; its password is for local use only. Do not copy production Secrets.

## Configure

Create these untracked `.env` files. The `.env.schema` beside each is the source
of truth for required values and defaults.

`apps/server/.env`:

```dotenv
NODE_ENV=development
BETTER_AUTH_SECRET=replace-with-a-random-secret-of-at-least-32-characters
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:password@localhost:5432/clichy?schema=public
PHOTO_STORAGE_PATH=./data/photos
REDIS_HOST=127.0.0.1
```

`apps/worker/.env`:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@localhost:5432/clichy?schema=public
PHOTO_STORAGE_PATH=../server/data/photos
REDIS_HOST=127.0.0.1
```

`apps/web/.env`:

```dotenv
NODE_ENV=development
VITE_SERVER_URL=http://localhost:3000
```

`packages/db/.env`:

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/clichy?schema=public
```

API and worker must share the same database, Redis queue and resolved storage
directory. Defaults are Redis port 6379, DB 0, no password/TLS and queue
`photo-processing`. Set identical queue overrides in both services if needed.
The local schemas already supply these defaults.

## Start

```bash
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Open the Web URL printed by Vite (normally `http://localhost:5173`), sign up,
then upload a small JPEG/PNG/WebP/GIF. The API listens on port 3000; the worker
on 3001 for health/metrics. Expect upload status `202`, then completed processing
and available thumbnails. If Vite chooses another port, update `CORS_ORIGIN`.

Use `pnpm dev:web`, `pnpm dev:server` or `pnpm dev:worker` for one process.
`pnpm db:stop` preserves Compose volumes; `pnpm db:down` removes containers and
network, also preserving volumes. `db:reset` destroys the local database: it is
not a setup or troubleshooting shortcut.

Workspace responsibilities: `apps/web` is React Router; `apps/server` is Fastify
and the outbox dispatcher; `apps/worker` consumes jobs; `packages/db`, `auth`,
`jobs` and `ui` hold shared database, auth, queue and UI code.
