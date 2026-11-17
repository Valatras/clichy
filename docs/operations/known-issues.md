# Known issues and resolved incidents

This is a record of issues evidenced by current documentation, source, or Git history. Absence of an open item here does not mean the system has been tested comprehensively.

## Production database missing Prisma tables

**Status:** Resolved (2026-11-14)
**Affected component:** Production Better Auth / PostgreSQL deployment
**Symptoms:** Account registration returned HTTP 500 and logs reported Prisma `P2021`, missing `public.user`.
**Root cause:** The new Production database had not received migrations. Earlier deployment automation migrated Test but not Production.
**Resolution:** Applied pending `20261005225922_adding_photos_objects` migration to Production using `prisma migrate deploy` through a temporary loopback-only port-forward. Registration then worked.
**Verification:** The contemporaneous operations record reports Prisma schema up to date and a successful account creation; this is historical execution evidence, not a current live check.
**Relevant files:** `infra/kubernetes/scripts/migrate.sh`, `infra/kubernetes/scripts/deploy.sh`, `.github/workflows/ci.yml`, `packages/db/prisma/migrations/`.
**Related commits:** `c96c262` (“Fixing migration issue in prod and adding the migration process to ci/cd”), `c3624d8` (Production deployment script); detailed incident record was already in `docs/operations/known-issues.md` before this documentation work.

## PostgreSQL connectivity and Prisma deployment stability

**Status:** Historical fixes present; current operation unverified
**Affected component:** Prisma, PostgreSQL Service and deployment scripts
**Symptoms:** Commit history records `7e8f334` “fix connectivity issue between prisma and postgresql pod” and `21d2785` “fix: database to prisma connection stability.”
**Root cause:** Not established by commit subjects alone. Current migration script uses a loopback port-forward, dynamically discovers its local port, and validates with a PostgreSQL protocol `SELECT 1`; exact earlier failure mechanism is not established.
**Resolution:** Connectivity changes and a more defensive migration path are in the current tree.
**Verification:** Source inspection only for this documentation pass.
**Relevant files:** `infra/kubernetes/scripts/migrate.sh`, `packages/db/src/`, `infra/kubernetes/base/postgres/`.

### Prisma migrations over the CNPG loopback port-forward

**Status:** Resolved and confirmed by a successful Test workflow.

**Symptoms:** The migration script's `node-postgres` `SELECT 1` probe succeeded through `kubectl port-forward`, but Prisma `migrate deploy` and `migrate status` returned P1001. The port-forward was reset when Prisma opened its connection.

**Cause and resolution:** Prisma's PostgreSQL connector defaults to `sslmode=prefer`; the `pg` readiness probe does not request TLS for the generated URL. The port-forward URL is loopback-only, so `migrate.sh` now explicitly sets `sslmode=disable` when rewriting the temporary URL. This keeps the probe and Prisma on the same protocol. The Kubernetes Secret and application connection URL are not changed. The fix was confirmed by the Test deployment workflow.

**Relevant files:** `infra/kubernetes/scripts/migrate.sh`, `docs/infrastructure/ci-cd.md`.
**Related commits:** `7e8f334`, `21d2785`.

### Production CNPG application role mismatch

**Status:** Resolved; user confirmed the Production database connection and deployment flow work after the Secret reload correction.

**Symptoms:** Production `migrate.sh` port-forward failed on its first database connection. The primary Pod remained `Running`, and the direct local socket query returned `pg_is_in_recovery() = false`.

**Root cause:** The CNPG Cluster declares `bootstrap.initdb.owner: clichy`, but the Production application Secret originally used the PostgreSQL username `clichy_prod`. After the username was corrected, PostgreSQL still logged SQLSTATE `28P01` with `User "clichy" has no password assigned`. The Secret referenced by `bootstrap.initdb.secret` lacked CNPG's `cnpg.io/reload: "true"` label, so the Secret update did not promptly trigger reconciliation of the role password. The endpoint, primary, and PVCs were healthy; this is a credential synchronization issue, not a storage or port-forward routing failure.

**Resolution:** `prepare-namespace.sh` normalizes the local DB URL and `POSTGRES_USER` to `clichy`, retaining the current password and database name, and labels `clichy-postgres-app` with `cnpg.io/reload: "true"`. Apply the label immediately with `kubectl label secret clichy-postgres-app -n clichy-prod cnpg.io/reload=true --overwrite`; then confirm CNPG synchronizes the password before retrying migrations. Sync the updated script before the next environment preparation so the label persists. Do not delete or recreate the Cluster or its PVCs.

**Verification:** User confirmed that the corrected Production setup works. A successful migration-status/deployment run is operational evidence for database connectivity; it does not by itself verify physical streaming or failover.

**Relevant files:** `infra/kubernetes/scripts/prepare-namespace.sh`, `infra/kubernetes/cnpg/cluster.yaml`, `infra/kubernetes/overlays/prod/database/kustomization.yaml`, `infra/kubernetes/scripts/migrate.sh`.

## Test Citus sharding migration failed on a unique index

**Status:** Resolved; user confirmed the Test deployment workflow succeeded after the migration correction.
**Affected component:** Test Citus database, Prisma migration `20261116090000_citus_user_sharding`.
**Symptoms:** Test deployment stopped before applying application manifests. Prisma reported P3018 / PostgreSQL 42704 because the migration ran `ALTER TABLE "Photo" DROP CONSTRAINT "Photo_storageKey_key"`, but that object is a standalone unique index, not a table constraint.
**Root cause:** Prisma had created `Photo_storageKey_key` as an index. The migration treated it as a constraint. The failing `DO` block was rolled back, while SQL statements before the block may already have committed; Prisma also records the migration as failed and will not retry it automatically.
**Resolution:** The migration now drops the standalone unique index with `DROP INDEX IF EXISTS` and makes the pre-branch steps safe to rerun. The Test-only recovery helper marked the failed attempt rolled back so Prisma could retry it; it rejects Production.
**Verification:** User confirmed the Test deployment workflow completed successfully after this correction. This does not confirm the separate Citus shard layout; see the incident below.
**Relevant files:** `packages/db/prisma/migrations/20261116090000_citus_user_sharding/migration.sql`, `infra/kubernetes/scripts/migrate.sh`, `docs/database/migrations.md`.

### Test photo tables registered with one shard instead of hash sharding

**Status:** Resolved and verified on Test (`valtask`, commit `7769af8`).
**Affected component:** Citus table registration for Test `Photo` and `PhotoProcessingOutbox`.
**Symptoms:** Both tables appeared in `pg_dist_partition` with `partmethod = 'n'`, `repmodel = 's'`, colocation ID 0 and one metadata shard. Their row counts were zero. This describes coordinator-local tables tracked in Citus metadata, not reference replicas (`repmodel = 't'`).
**Root cause:** Citus enables `citus.enable_local_reference_table_foreign_keys` by default and tracks local tables related to reference tables in its metadata. The registration SQL treated any metadata row as successful distribution and skipped `create_distributed_table`; the workflow had no post-registration invariant check. The execution output supplied by the user also came from the old ConfigMap: it printed “already distributed” and no final validation success. The `pg_get_expr(p.partkey, ...)` diagnostic failed because Citus stores `partkey` as text; use `column_to_column_name` instead.
**Resolution:** The registration session disables automatic local-reference FK metadata tracking and validates that User is a reference and both photo tables are hash-distributed on `userId` with 32 shards and matching colocation IDs. The separately gated empty-state repair created the shards; migration `20261117120000_citus_shard_key_fk_update_restrict` restored both FKs with `ON UPDATE RESTRICT`. The repair script is not part of normal deployment and must not be rerun against the repaired state.
**Verification:** User confirmed the Test workflow completed, Prisma records the new FK migration as finished, metadata reports 32 hash shards for both tables with colocation ID 2, and the parent plus shard-level constraints show the expected `ON UPDATE RESTRICT`, `ON DELETE RESTRICT` (Photo-to-User) and `ON DELETE CASCADE` (outbox-to-Photo).
**Relevant files:** `infra/kubernetes/citus/enable-user-sharding.sql`, `infra/kubernetes/citus/repair-empty-local-photo-tables.sql`, `infra/kubernetes/citus/enable-user-sharding.test.mjs`, `docs/database/sharding.md`.

**Follow-up:** The guarded repair initially stopped after shard creation because Citus rejected `ON UPDATE CASCADE` on a distribution-key FK. The subsequent Prisma migration restored both constraints with Citus-compatible update behavior; the final deployment and shard-level constraint check succeeded.

## Traefik Ingress routing corrections

**Status:** Historical correction committed; current reachability unverified
**Affected component:** Clichy and Headlamp Ingress
**Symptoms:** Git history records a Traefik port/entrypoint correction and Headlamp Ingress namespace correction.
**Root cause:** Commit message `637e762` says base Ingress did not explicitly select `web`, and Headlamp Ingress had been declared in `default`; details beyond that message are not established.
**Resolution:** Base Clichy Ingress explicitly uses entrypoint `web`; Headlamp Ingress is in `headlamp`, and installer removes the earlier misplaced resource.
**Verification:** Current manifest/source inspection only.
**Relevant files:** `infra/kubernetes/base/ingress.yaml`, `infra/kubernetes/headlamp/lan-ingress.yaml`, `infra/kubernetes/scripts/install-headlamp.sh`.
**Related commit:** `637e762`.

## PostgreSQL data directory ownership

**Status:** Current fix committed; live storage not verified
**Affected component:** Production PostgreSQL StatefulSet and local PV setup
**Symptoms:** Most recent commit title indicates a permissions issue for PostgreSQL UID 999.
**Root cause:** The commit message establishes that the data directory permissions needed correction for UID 999; exact runtime symptom is not available from repository evidence.
**Resolution:** Current `prepare-namespace.sh` checks/sets ownership for an empty PostgreSQL directory and `2a7717f` adjusts ownership handling. It intentionally refuses unsafe recursive ownership changes on populated data.
**Verification:** Source inspection; not tested against live volume.
**Relevant files:** `infra/kubernetes/scripts/prepare-namespace.sh`, `infra/kubernetes/base/postgres/statefulset.yaml`.
**Related commits:** `2a7717f`, `4bceaff`.

## Operational gaps (not recorded incidents)

These are limitations established by configuration, not claims of past failures: direct CNPG WAL streaming/failover evidence is still outstanding; Test Citus is a single-node logical sharding baseline without HA or multi-node capacity; no tested backup/restore runbook exists, Redis is a single instance, and no Test refresh/anonymization procedure exists. See the database pages and requirements matrix.
