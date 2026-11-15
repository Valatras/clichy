# ADR 0007: No database replication or sharding in current baseline

**Status:** Current configuration fact; revisit if measured needs justify a design.

## Context

Assignment asks for replication and sharding, but current repository config has one PostgreSQL StatefulSet replica and no Citus or replica configuration.

## Decision

Document these as gaps, not implemented features. Do not scale StatefulSet replicas to simulate database HA.

## Alternatives considered

A PostgreSQL operator/managed service and Citus were not implemented in current tree; design alternatives remain open.

## Consequences

Single-instance database operations are simpler but have availability/capacity limitations. A future implementation requires failover, recovery, migration and validation procedures.
