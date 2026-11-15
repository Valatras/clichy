# Developer onboarding

## 1. Install tools and dependencies

Install Node.js 24, pnpm 12.8.1, Git, and Docker with Compose. Then clone the repository and install dependencies:

```bash
git clone https://github.com/valatras/clichy.git
cd clichy
corepack enable
corepack prepare pnpm@12.8.1 --activate
pnpm install
```

`pnpm install` triggers Varlock code generation through the root `postinstall` script. It does not start services.

## 2. Start local dependencies

```bash
pnpm db:start
```

This invokes the database workspace's `docker compose up -d`, starting PostgreSQL and Redis with named local volumes. The compose file exposes ports 5432 and 6379 on the host. Its sample PostgreSQL password is for local development only; do not reuse it elsewhere.

Configure local environment files based on the `.env.schema` files. Use a local PostgreSQL URL targeting database `clichy`, and set API/worker Redis host to `127.0.0.1`. Provide a unique Better Auth secret of at least 32 characters and matching local auth/CORS URLs. Never copy production Secret values.

## 3. Prepare Prisma and run services

```bash
pnpm db:generate
pnpm db:migrate
pnpm dev
```

`db:generate` creates the Prisma client. `db:migrate` runs `prisma migrate dev` and may prompt to create/apply local migrations. `pnpm dev` runs package `dev` tasks through Turbo; use `pnpm dev:web`, `pnpm dev:server`, or `pnpm dev:worker` for an individual service. Confirm Vite's printed URL and that `VITE_SERVER_URL` points to the API.

## 4. Useful commands

```bash
pnpm check-types
pnpm --filter server test
pnpm --filter worker test
pnpm build
pnpm db:studio
pnpm db:stop
pnpm db:down
```

These names are defined in root/workspace manifests. `db:stop` stops containers but preserves volumes; `db:down` removes Compose containers/network but leaves named volumes unless `-v` is explicitly passed (which is not part of the script).

For image builds, use the existing Dockerfiles with repository root as build context:

```bash
docker build -f infra/docker_clichy_server/Dockerfile -t clichy-server:local .
docker build -f infra/docker_clichy_web/Dockerfile -t clichy-web:local .
docker build -f infra/docker_clichy_worker/Dockerfile -t clichy-worker:local .
```

## Troubleshooting

- Prisma client missing: run `pnpm db:generate` after install/schema changes.
- Connection refused: check `docker compose ps` in `packages/db`, then check ports and URLs.
- Login fails locally: check `BETTER_AUTH_URL`, `CORS_ORIGIN`, secret length, and browser API URL alignment.
- Worker reports no Redis: check Redis host/port/credentials and that worker shares the same queue name as the server.
- Generated environment types missing: run `pnpm env:generate` after schema changes.
- Avoid `pnpm db:reset` unless you intend to drop and recreate the local database.
