# ADR 0008: Zero-downtime rollout is not yet verified

**Status:** Open evaluation criterion.

## Context

Kubernetes Deployments roll Pods, and deployment scripts wait for rollout completion. Default app replicas are one, and schema changes run before app manifests are updated.

## Decision

Describe rolling update capability as configured but do not claim zero downtime without an observed test.

## Alternatives considered

Multiple replicas and explicit rollout strategy can improve availability but must account for shared storage and database schema compatibility; no completed demonstration is recorded.

## Consequences

A controlled deployment test with health checks, concurrent requests, metrics and a migration is needed before claiming the requirement is met.
