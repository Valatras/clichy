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

**Status:** Cause confirmed from cluster logs; the credential correction was applied on `valtask`, but authentication remains unverified until CNPG applies the role password.

**Symptoms:** Production `migrate.sh` port-forward failed on its first database connection. The primary Pod remained `Running`, and the direct local socket query returned `pg_is_in_recovery() = false`.

**Root cause:** The CNPG Cluster declares `bootstrap.initdb.owner: clichy`, but the Production application Secret originally used the PostgreSQL username `clichy_prod`. After the username was corrected, PostgreSQL still logged SQLSTATE `28P01` with `User "clichy" has no password assigned`. The Secret referenced by `bootstrap.initdb.secret` lacked CNPG's `cnpg.io/reload: "true"` label, so the Secret update did not promptly trigger reconciliation of the role password. The endpoint, primary, and PVCs were healthy; this is a credential synchronization issue, not a storage or port-forward routing failure.

**Resolution:** `prepare-namespace.sh` normalizes the local DB URL and `POSTGRES_USER` to `clichy`, retaining the current password and database name, and labels `clichy-postgres-app` with `cnpg.io/reload: "true"`. Apply the label immediately with `kubectl label secret clichy-postgres-app -n clichy-prod cnpg.io/reload=true --overwrite`; then confirm CNPG synchronizes the password before retrying migrations. Sync the updated script before the next environment preparation so the label persists. Do not delete or recreate the Cluster or its PVCs.

**Verification required:** Confirm a fresh PostgreSQL authentication attempt succeeds and CNPG logs stop reporting password/owner errors, then run `./infra/kubernetes/scripts/migrate.sh prod status` and the Production workflow. Do not mark the Production correction operational until these succeed.

**Relevant files:** `infra/kubernetes/scripts/prepare-namespace.sh`, `infra/kubernetes/cnpg/cluster.yaml`, `infra/kubernetes/overlays/prod/database/kustomization.yaml`, `infra/kubernetes/scripts/migrate.sh`.

## Citus sharding experiment

**Status:** Historical experiment; not operational
**Affected component:** Database architecture
**Symptoms:** Project context supplied for this documentation task reports Citus was experimentally introduced, encountered problems, and was not retained.
**Root cause:** Not verified from current repository or available commit subjects.
**Resolution:** Current architecture is standard PostgreSQL plus Redis/BullMQ; current schema/manifests show no Citus deployment.
**Verification:** Current manifests and package files inspected; a working Citus setup is absent.
**Relevant files:** `infra/kubernetes/base/postgres/`, `packages/db/`.
**Related commits:** No Citus-specific commit was identified in current `master` history search. Treat the experiment history as project-provided context until historical commits/docs are made available.

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

These are limitations established by configuration, not claims of past failures: CNPG replication is configured but not yet deployed/verified, PostgreSQL sharding is absent, no tested backup/restore runbook exists, Redis is a single instance, and no Test refresh/anonymization procedure exists. See the database pages and requirements matrix.
