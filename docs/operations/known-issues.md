# Known issues and resolved incidents

## Production database missing Prisma tables

**Status:** Resolved  
**Resolution date:** 2026-11-14

### Symptoms

- The production site at `https://valtask.xyz` was reachable.
- Account registration failed with HTTP 500 (`api/auth/sign-up/email: 500`).
- Unauthenticated requests to `/photos` returned HTTP 401. That is expected for
  a protected resource and was not the database failure.
- Server logs reported Prisma error `P2021`:
  `The table public.user does not exist in the current database.`

### Root cause

The newly created Production PostgreSQL database had not received its Prisma
migrations. Test and Production use independent databases, so successfully
migrating Test does not initialize Production. The existing CI/CD workflow
migrated Test, but the Production deployment procedure did not migrate the
Production database before deploying the application.

Better Auth queried the missing `public.user` table during registration,
causing HTTP 500 responses.

### Resolution

The repository was checked out at commit
`c3624d8c452d85d1f8fa4c2b1fa2b62aad030765` (commit date 2026-11-13). The
pending migration was `20261005225922_adding_photos_objects`.

The command `pnpm --filter @clichy/db db:migrate:deploy` was run against the
Production database, not the local development database. A temporary
loopback-only port-forward accessed the Production PostgreSQL Service:

```bash
kubectl port-forward --address 127.0.0.1 \
  -n clichy-prod service/clichy-postgres 25434:5432
```

The `DATABASE_URL` was retrieved from the Kubernetes Secret
`clichy-prod-secrets` without printing its value, then adjusted locally to use
`127.0.0.1:25434` for the duration of the command. No credential or URL is
recorded here.

After the migration, Prisma reported the schema up to date, Production
registration worked, and a Production user account was successfully created.

The port-forward was temporary and used only for the manual migration. It is
not a permanent service, does not need to remain running, and does not expose
PostgreSQL to the LAN or Internet.

### Prevention and recovery

- The deployment workflow now applies pending migrations from the checked-out
  commit before applying the application manifests. A failed migration fails
  the deployment job and leaves the application manifests unapplied.
- Test and Production keep independent namespaces, PostgreSQL Services,
  Secrets, and databases (`clichy_test` and `clichy_prod`).
- Use the exact commit SHA associated with the GHCR images being deployed.
- Prefer backward-compatible, expand-and-contract migrations so the currently
  running application can continue to serve traffic while a migration runs.
- Never use `prisma migrate reset` or `prisma db push` as a Production migration
  or recovery strategy.
- Never print database credentials or Secret contents in CI logs.
- If a migration or rollout fails, inspect the migration status, PostgreSQL
  logs, and rollout history before taking action. Do not reset the database or
  delete PVCs to address a migration error.

For manual status inspection, run
`./infra/kubernetes/scripts/migrate.sh test status` or
`./infra/kubernetes/scripts/migrate.sh prod status` from the checked-out
repository on `valtask`. This command does not apply migrations. Prisma may
return a non-zero status when migrations are pending; use the workflow or
`./infra/kubernetes/scripts/migrate.sh <environment> deploy` to apply them.

The dedicated LVM volume under `/srv/clichy` is a separate pending
infrastructure task: Kubernetes PVCs still use the existing `local-path`
provisioner storage under `/var/lib/rancher/k3s/storage`. No storage changes
were made as part of this incident resolution or migration automation.
