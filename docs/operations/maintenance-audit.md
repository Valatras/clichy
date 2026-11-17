# Maintenance audit and validation record

## Initial findings and priorities

The review covered workspace manifests and service boundaries under `apps/` and
`packages/`, Kubernetes bases/overlays and database resources, operational
scripts, the CI workflow, MkDocs navigation and architecture/operations pages.
This is a source review, not a live infrastructure assessment.

| Finding | Benefit / risk | Decision |
| --- | --- | --- |
| Routine checks require scattered kubectl/SQL commands | High / low | Add one read-only environment-aware healthcheck and offline failure tests |
| Citus postconditions embedded in registration | High / low | Extract unchanged validator; registration includes it and healthchecks stream it from the checkout |
| ADR 0004, home and architecture say sharding absent | High / low | Mark old decision superseded; describe Test Citus separately from CNPG |
| Root README repeats setup and misstates Production trigger | High / low | Link onboarding as the entry point and document manual Production dispatch |
| Manual dispatch publishes images but GHCR login covers only pushes | High / low | Align login with existing publication conditions |
| deploy/migrate/CI repeat valtask checks | Moderate / moderate | Retain: these protect different entry points; a shared shell dependency adds clean-checkout/security scope and requires its own failure tests |
| Empty-Citus repair and legacy PostgreSQL manifests look historical | Moderate / high | Retain: repair is referenced by incident history and ConfigMap; old Production volumes are explicitly retained |
| Monitoring installer combines Helm, credentials and exposure | Moderate / high | Retain its existing confirmations and upgrade gate; splitting would need installation/recovery validation |
| Photo routes are long; storage/routes/worker repeat a small ENOENT predicate | Low / moderate | Retain tested service boundaries; extracting cross-service helpers for a few lines adds coupling |

## Changes and responsibility boundaries

- `healthcheck.sh` performs bounded read-only observations; no Secret reads,
  deployments, migrations, context changes or recovery.
- `validate-user-sharding.sql` contains the former registration postconditions.
  `enable-user-sharding.sql` includes it with a path relative to the SQL file;
  Kustomize mounts both. The historical repair still calls registration and
  reaches the same validator. No applied Prisma migration changed.
- Offline Node tests exercise healthy Test/Production, inaccessible Kubernetes,
  pending migrations, incompatible Citus and absent streaming, exit codes,
  namespace/request bounds and credential suppression. CI runs these tests.
- Documentation adds the healthcheck entry point and decision history corrections.
  Existing diagrams already cover network, asynchronous processing and CI;
  the new decision-flow diagram explains environment-specific observations.
- README setup prose was removed in favor of onboarding and schema references;
  no script, manifest, recovery procedure or incident record was deleted.

## Deliberately preserved

No public API, BullMQ contract, Prisma schema, storage semantics or image
processing behavior changed. No generic Bash framework was added. Deployment
SHA/node/confirmation guards, isolated Secrets and migration-before-deployment
ordering remain intact. No real cluster command was executed.

The historical empty-table repair remains exceptional and explicitly gated.
Its SQL must not be used as a routine validation command. Detailed SQL remains
in the sharding guide for teaching and investigation.

## Local validation and remaining limits

The 11 offline healthcheck tests and 8 existing Citus guard tests pass. Bash syntax
and `git diff --check` pass. Kustomize renders Test, Production and Citus without
cluster access. ShellCheck is not installed. MkDocs builds with `--strict` using the existing
`/tmp/clichy-mkdocs-venv` environment. Test, Production, Dev, database overlays
and Citus render with `kubectl kustomize`. The server test command stalled in
pnpm dependency/supply-chain initialization and was interrupted; worker tests,
`pnpm check-types` and `pnpm build` were bounded attempts that did not reach
execution (workspace dependencies unavailable). They are not successful checks.
The installed Turbo package cannot be resolved locally; no Turbo configuration
or commands were changed.
Healthchecks have not been run against valtask. Mocked tests cannot validate
PostgreSQL permissions, actual Citus catalog behavior, CNPG streaming or RBAC.

No immediate action on valtask is necessary to review these changes. After
review, an operator can run the read-only healthcheck from the intended commit.
The extracted validator is included in the next normal Citus ConfigMap rollout;
healthchecks themselves stream the local file and do not require that rollout.
