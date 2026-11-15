# Testing and build checks

The repository uses Node's built-in test runner through `tsx`. Server tests cover storage, metrics, image processing, photo queries/routes, and outbox dispatch. Worker tests cover job processing behavior.

```bash
pnpm check-types
pnpm --filter server test
pnpm --filter worker test
pnpm build
```

CI uses the same commands after `pnpm install --frozen-lockfile`, with Node 24. Type checking receives a placeholder `DATABASE_URL` and web server URL; tests/build may depend on package environment configuration. The workflow does not run a dedicated lint task despite a root Turbo `lint` task definition.

For focused debugging, execute the package script or the test file via its package runner, for example `pnpm --filter server exec tsx --test src/image-processing.test.ts`. No test command has been run during this documentation edit; see the validation report for documentation build status.
