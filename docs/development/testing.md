# Testing

**What is it?** Tests check behavior locally; type checking and builds verify
workspace integration. They do not establish the health of a deployed cluster.

**Why Clichy uses it** CI must reject broken photo processing or incompatible
changes before publishing images.

After [installing and configuring](onboarding.md), run:

```bash
pnpm check-types
pnpm --filter server test
pnpm --filter worker test
pnpm build
node --test packages/db/prisma/sharding.test.mjs infra/kubernetes/scripts/healthcheck.test.mjs
```

Server/worker suites use Node's test runner through `tsx`: storage, image
processing, ownership queries/routes, outbox dispatch, metrics and job failures.
Run a focused file with `pnpm --filter server exec tsx --test src/image-processing.test.ts`.

The shell tests mock kubectl: they exercise read-only behavior, missing
components, timeouts, namespace isolation and exit codes without a cluster.
To test all historical migrations plus Citus registration against the pinned
image, with Docker available:

```bash
docker pull citusdata/citus:14.2.0
docker build -t clichy-cnpg-citus:18.6-14.2.0 infra/kubernetes/cnpg
CLICHY_TEST_CITUS=1 node packages/db/prisma/sharding.test.mjs
```

These tests create/remove disposable containers and an internal Docker network,
without host mounts or published ports. They cover immutable migration history,
legacy Production conversion, non-superuser SCRAM, certificate-authenticated COPY,
logical restore, physical streaming and native PostgreSQL promotion. The latter
is not an operator-managed CNPG failover test. Historical migration branches and
invalid metadata remain covered.
The integration case is explicitly skipped in the default offline test run.

For infrastructure changes, run `bash -n` on changed shell scripts, ShellCheck
if installed, and `kubectl kustomize infra/kubernetes/overlays/test` (also
`prod` and the separate database overlays). Rendering does not
apply resources. Build this documentation with:

```bash
python3 -m venv /tmp/clichy-docs
/tmp/clichy-docs/bin/pip install -r docs/requirements.txt
/tmp/clichy-docs/bin/mkdocs build --strict
```

An upload smoke test writes application data. A healthcheck only observes state;
keep these results separate when recording a demonstration.

Mermaid is pinned to 11.17.2. Validate rendering with that version; unescaped
semicolons in sequence messages separate instructions and must be avoided.
