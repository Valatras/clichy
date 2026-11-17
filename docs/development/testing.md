# Testing and build checks

The repository uses Node's built-in test runner through `tsx`. Server tests cover storage, metrics, image processing, photo queries/routes, and outbox dispatch. Worker tests cover job processing behavior.

```bash
pnpm check-types
pnpm --filter server test
pnpm --filter worker test
pnpm build
```

CI uses the same commands after `pnpm install --frozen-lockfile`, with Node 24. Type checking receives a placeholder `DATABASE_URL` and web server URL; tests/build may depend on package environment configuration. The workflow does not run a dedicated lint task despite a root Turbo `lint` task definition.

For focused debugging, execute a package test file, for example `pnpm --filter server exec tsx --test src/image-processing.test.ts`. The server and worker test suites and type checks are run as part of the local validation for changes to the asynchronous photo pipeline.
