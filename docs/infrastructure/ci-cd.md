# CI/CD pipeline

The single workflow is `.github/workflows/ci.yml`, triggered by pushes and pull requests to `master`.

```mermaid
flowchart TD
  Push[Push or PR to master] --> CI[Install frozen deps; typecheck; server tests; worker tests; build]
  CI -->|success| Images[Build server/web/worker images]
  Images -->|push to master| GHCR[Publish sha-<commit> tags]
  Images -->|PR| BuildOnly[Build only, no publish]
  GHCR --> Test[Self-hosted runner: verify SHA + single valtask node]
  Test --> TestMigrate[Prisma migrate deploy to Test]
  TestMigrate --> TestApply[Apply Test manifests and await rollouts]
  TestApply --> ProdDispatch{Manual workflow dispatch with deploy_prod=true?}
  ProdDispatch -->|yes| ProdGate[GitHub production Environment]
  ProdGate --> ProdMigrate[Prisma migrate deploy to Production]
  ProdMigrate --> ProdApply[Apply Production manifests and await rollouts]
```

## Sequence and gates

1. CI uses GitHub-hosted Ubuntu, pnpm action, Node 24 and frozen lockfile. It runs `pnpm check-types`, server tests, worker tests, and `pnpm build`.
2. Packaging builds three Docker images from root context and service Dockerfiles. Only push-to-master logs into GHCR and pushes tags `ghcr.io/valatras/clichy-{server,web,worker}:sha-${GITHUB_SHA}`. Pull requests build without publishing.
3. Test deploy runs on a self-hosted Linux runner. It requires checked-out SHA to equal workflow SHA and exactly one cluster node named `valtask`. It applies monitoring manifests, runs `deploy.sh test sha-...`, and reports resources even on failure.
4. Pushes deploy Test only. Production requires manually dispatching the workflow on `master` with `deploy_prod=true`; that run rebuilds, redeploys Test, then uses GitHub Environment `production` and the same exact-SHA checks before deploying `prod`.
5. `deploy.sh` invokes migration first. If migration fails, application manifests are not applied. On success it renders the overlay with the SHA, applies it, then waits up to five minutes for server, web, and worker rollouts.

GitHub Environment review/approval is not configured in the YAML; it may be configured in repository settings. Production's manual dispatch gate prevents a Test push from automatically changing Prod. There is no separate Test smoke-test step or automatic rollback job. A failing rollout stops the job, but rollback is an operator action. No zero-downtime demonstration is included.

## Migration workflow detail

`deploy.sh` waits for the environment CNPG Cluster. For Test, it also applies and waits for the standalone Citus Deployment. `migrate.sh` verifies a clean checked-out source, verifies node `valtask`, reads the environment Secret's DATABASE_URL without printing it, port-forwards the environment's database Service to an ephemeral loopback port, performs a PostgreSQL protocol `SELECT 1`, then invokes `prisma migrate deploy` (or `prisma migrate status`). Test migrations additionally register the photo and outbox tables as Citus-distributed; Dev and Production use CNPG. For the loopback-only port-forward it sets `sslmode=disable` so Prisma and the node-postgres probe use the same protocol. It unsets credentials and cleans up the port-forward. Migrations run before new app manifests, so they must remain compatible with currently running code during that interval.
