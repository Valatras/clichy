# ADR 0006: Environment namespaces

**Status:** Adopted in overlays.

## Context

Test and Production need distinct settings, credentials and databases; Dev is configured separately.

## Decision

Use namespace-per-environment with independent resources, Secrets, URLs and PostgreSQL databases. CI deploys Test before Production.

## Alternatives considered

Separate clusters are not configured. No formal alternatives record was found.

## Consequences

Namespace separation reduces accidental cross-environment naming/configuration overlap but shares the same cluster/node and does not guarantee resource/failure isolation. Test-to-Production promotion is ordered by workflow dependencies, but explicit application validation/approval depends partly on GitHub Environment settings.
