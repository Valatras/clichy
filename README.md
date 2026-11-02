# clichy

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, React Router, Fastify, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **React Router** - Declarative routing for React
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Fastify** - Fast, low-overhead web framework
- **Node.js** - Runtime environment
- **Prisma** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

Generate the Prisma client before development, typechecking, or building, including in CI and deployment builds. Run this again after changing the Prisma schema:

```bash
pnpm run db:generate
```

This project uses PostgreSQL with Prisma.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the committed Prisma migrations to your database:

```bash
pnpm --filter @clichy/db db:migrate:deploy
```

For persistent environments, use `prisma migrate deploy` rather than `db:push`. Supply `DATABASE_URL` through a secure environment or secret manager; do not commit it. Create new migrations during development with `pnpm run db:migrate`.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Kubernetes Databases

The Kubernetes environments use isolated databases and Secrets. The PostgreSQL Service listens on port `5432` inside each namespace.

| Environment | Namespace | Database | Local port-forward | Status |
| --- | --- | --- | --- | --- |
| Dev | `clichy-dev` | `clichy_dev` | `25432` | Configured |
| Test | `clichy-test` | `clichy_test` | `25433` | Configured |
| Prod | `clichy-prod` | `clichy_prod` | `25434` | Not deployed; provision a Secret and confirm the production hostname/TLS first |

Each configured namespace needs a `clichy-server-secrets` Secret with `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `BETTER_AUTH_SECRET`. Keep these values outside Git. `DATABASE_URL` must use that environment's credentials and database name, with reserved password characters URL-encoded. Changing `POSTGRES_DB` does not create or rename a database in an already-initialized PostgreSQL volume.

### Connect and migrate Dev or Test

In a first terminal, start a port-forward for the environment. For Dev:

```bash
kubectl port-forward -n clichy-dev svc/clichy-postgres 25432:5432
```

For Test, use `kubectl port-forward -n clichy-test svc/clichy-postgres 25433:5432`.

In a second terminal, set the namespace and matching local port. The command below reads credentials directly from the Kubernetes Secret, rewrites only the connection host/port, and does not print the URL:

```bash
export NAMESPACE=clichy-test
export LOCAL_PORT=25433
export DATABASE_URL="$(
  kubectl get secret clichy-server-secrets -n "$NAMESPACE" -o json |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const data = JSON.parse(input).data;
        const decode = key => Buffer.from(data[key], "base64").toString("utf8");
        const url = new URL(decode("DATABASE_URL"));
        url.hostname = "127.0.0.1";
        url.port = process.env.LOCAL_PORT;
        url.username = decode("POSTGRES_USER");
        url.password = decode("POSTGRES_PASSWORD");
        url.pathname = "/" + decode("POSTGRES_DB");
        if (!url.searchParams.has("schema")) url.searchParams.set("schema", "public");
        process.stdout.write(url.toString());
      });
    '
)"
```

Connect with `psql "$DATABASE_URL"` or apply the checked-in Prisma migrations:

```bash
pnpm --filter @clichy/db db:migrate:deploy
unset DATABASE_URL NAMESPACE LOCAL_PORT
```

Use `NAMESPACE=clichy-dev` and `LOCAL_PORT=25432` for Dev. Prod is not currently provisioned in the cluster; do not use the example hostname in its overlay as a real production endpoint. Before enabling it, create a namespace-local Secret, configure the real hostname and TLS, then deploy its overlay and use local port `25434` for access.

The Test API currently mounts the existing `clichy-server-photos` PVC as a temporary fallback. The overlay's NFS PV refers to host `valtask`, which the Kubernetes node cannot resolve. Reapplying the Test overlay will restore that broken NFS claim; configure a resolvable NFS host before doing so. No PV, PVC, or photo data was changed for the database reset.

The CI deployment does not run migrations. `db:migrate:deploy` runs `prisma migrate deploy` and applies committed migrations without resetting data. Create migrations during development with `pnpm run db:migrate`; do not use `db:push` for persistent environments.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@clichy/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Project Structure

```
clichy/
├── apps/
│   ├── web/         # Frontend application (React + React Router)
│   └── server/      # Backend API (Fastify)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm --filter @clichy/db db:migrate:deploy`: Apply committed Prisma migrations
- `pnpm run db:migrate`: Create and apply a migration during development
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:studio`: Open database studio UI

## Better Auth Schema Generation

After changing auth plugins or schema options, run `pnpm run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
