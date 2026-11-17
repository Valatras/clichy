# Deployment runbook

Routine status checks: [read-only environment healthchecks](../operations/healthchecks.md).

## Automated deployment

Push to `master` triggers CI, image builds, Test deployment and then Production deployment, as described in [CI/CD](../infrastructure/ci-cd.md). Deployment uses exact commit SHA tags. The self-hosted runner must have access to the target K3s kubeconfig, `kubectl`, Node 24, pnpm, GHCR, and namespace secrets. The script refuses to run unless the cluster reports exactly one node named `valtask`.

## Manual checked-out SHA deployment

From a clean checkout that matches the published images:

```bash
CLICHY_DEPLOY_CONFIRM=yes ./infra/kubernetes/scripts/deploy.sh test sha-<40-character-commit-sha>
CLICHY_DEPLOY_CONFIRM=yes ./infra/kubernetes/scripts/deploy.sh prod sha-<40-character-commit-sha>
```

Use manual commands only when the selected image tag exists and `git rev-parse HEAD` matches it. Production deploy additionally checks required Secret keys and GHCR pull-secret type. The script migrates first, renders manifests into a temporary Kustomize directory, applies the environment, waits for API/web/worker rollouts, and prints workload status. Without `CLICHY_DEPLOY_CONFIRM=yes`, it asks for interactive confirmation.

## Before/after checks

```bash
kubectl config current-context
kubectl get nodes
./infra/kubernetes/scripts/migrate.sh test status
kubectl get deployments,pods,pvc,ingress -n clichy-test -o wide
kubectl rollout history deployment/clichy-server -n clichy-test
```

After a failure, inspect `kubectl describe`, events, Pod logs, migration status, and PostgreSQL logs before retrying. There is no automated rollback step. Do not delete PVCs or reset the database to address rollout failures. A deliberate rollback would need a compatible prior image SHA and an operator review of schema compatibility; the repo does not provide a turnkey rollback script.
