# Prisma schema migrations

## Local workflow

Edit the Prisma schema, then use:

```bash
pnpm db:generate
pnpm db:migrate
```

The root `db:migrate` delegates to `@clichy/db` and runs `prisma migrate dev`; it can create a migration and prompt in development. Review and commit the generated SQL under `packages/db/prisma/migrations` with the schema change. `pnpm db:push` is available but bypasses migration history; do not use it for production changes.

Inspect migration state:

```bash
pnpm --filter @clichy/db exec prisma migrate status
./infra/kubernetes/scripts/migrate.sh test status
./infra/kubernetes/scripts/migrate.sh prod status
```

The environment script uses the namespace Secret and loopback port-forward. It does not print the DB URL. Running status can return nonzero when migrations are pending.

## Deployment ordering

```mermaid
flowchart TD
  SHA[Checked out SHA + matching immutable images] --> Verify[Verify clean source, node and target Secret]
  Verify --> Ready[Wait for CNPG Cluster Ready]
  Ready --> Forward[Loopback port-forward: Test Citus / Production CNPG; SELECT 1]
  Forward --> Migrate[prisma migrate deploy]
  Migrate -->|Test success| Citus[Register Citus and validate sharding]
  Citus -->|success| Apply[Render and apply environment Kustomize overlay]
  Citus -->|failure| Stop
  Migrate -->|Production success| Apply
  Migrate -->|failure| Stop[Stop; app manifests not applied]
  Apply --> Rollout[Wait for server, web, worker rollouts]
```

The workflow applies migrations before deploying the matching app images. The migration script confirms the target database name (`clichy_test` or `clichy_prod`) from the connection URL and checks commit cleanliness for relevant sources. Because old Pods may serve while DDL runs, use backward-compatible expand-and-contract migrations. No transactional rollback or automatic schema rollback is provided; Prisma migration failures require diagnosis and a forward repair plan.

## Recovering the Test Citus sharding migration

The first Test attempt at `20261116090000_citus_user_sharding` failed because it tried to drop the Prisma-created `Photo_storageKey_key` unique index as a table constraint. The migration is now repeatable across the already-committed statements, and drops that object as an index. Once the fix is present in the checkout on `valtask`, first mark the failed Test attempt as rolled back:

```bash
./infra/kubernetes/scripts/migrate.sh test resolve-citus-failure
```

Then rerun the failed Test deployment workflow. The helper connects only to the Test Citus Service and refuses Production. Do not use `migrate resolve --applied`, delete the Test database, or remove its PVC: the corrected migration must run and create the schema changes. Confirm the migration and app rollout in the workflow logs. This is a recovery for this migration ID; investigate other migration failures individually before resolving them.
