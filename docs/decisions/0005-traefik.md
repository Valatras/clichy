# ADR 0005: Traefik as ingress controller

**Status:** Configured by K3s defaults and repository Ingress resources.

## Context

Browser traffic needs host/path routing to UI and API, while cluster services remain internal.

## Decision

Use Traefik's `traefik` IngressClass; base Clichy ingress uses the `web` entrypoint. K3s installer retains default Traefik installation.

## Alternatives considered

No controller comparison was found.

## Consequences

K3s defaults make initial on-premise setup simpler. Hostnames, TLS, DNS and external exposure remain environment-specific; current Clichy Ingress does not configure TLS.
