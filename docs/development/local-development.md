# Local development

Local service orchestration is split: `packages/db/docker-compose.yml` starts PostgreSQL and Redis; root Turbo scripts run web, server, and worker processes. There is no root Compose file orchestrating all application services.

The expected development sequence is:

```bash
pnpm db:start
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The API listens on port 3000 in `apps/server/src/index.ts`. The worker exposes health on port 3001. The React Router dev server chooses its local port and reports it at startup. The browser API URL is controlled by `VITE_SERVER_URL`.

For an isolated service, run `pnpm dev:web`, `pnpm dev:server`, or `pnpm dev:worker`. Keep API and worker pointed at the same `PHOTO_STORAGE_PATH`; otherwise the worker cannot read originals or the API cannot serve generated derivatives. This local filesystem coordination is also required in Kubernetes.

Use database migration commands for development changes; do not use `db:push` as a substitute for a committed migration workflow when schema history matters. Use `pnpm db:studio` to inspect records locally. Local startup has not been executed as part of this documentation pass.
