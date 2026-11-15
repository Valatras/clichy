# ADR 0004: Citus sharding experiment

**Status:** Rejected/abandoned experiment; not current architecture.

## Context

Project-provided history says Citus was introduced experimentally to explore PostgreSQL sharding, encountered problems, and was not retained as a validated design.

## Decision

The current repository uses standard PostgreSQL and does not configure Citus. No operational sharding claims should be made.

## Alternatives considered

Current single PostgreSQL instance is the implemented baseline. A formal comparison or exact experiment commit is not available in the checked-out history reviewed here.

## Consequences

The application has no shard routing or distributed transaction model. Future scaling should start with measured evidence and a documented design. Citus failure root cause and precise experiment outcomes remain unverified.
