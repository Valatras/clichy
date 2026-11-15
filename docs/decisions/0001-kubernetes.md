# ADR 0001: Kubernetes and environment namespaces

**Status:** Adopted in repository configuration; live operational status not independently verified.

## Context

The project targets self-hosted deployment on K3s and needs isolated Dev, Test, and Production configuration plus containerized services.

## Decision

Use Kubernetes resources rendered with Kustomize, K3s for the on-premise cluster setup, Traefik Ingress, and `clichy-dev`, `clichy-test`, `clichy-prod` namespaces. Monitoring and Headlamp are separate cluster tools.

## Alternatives considered

No alternatives are recorded in a formal ADR. Docker Compose is provided for local Postgres/Redis only, not as a production runtime.

## Consequences

Kubernetes supplies scheduling, service discovery, probes and Deployment rollouts. Operators must manage cluster access, PVCs, secrets, ingress, and node/storage availability. Namespaces isolate names and configuration but do not provide separate cluster failure domains.
