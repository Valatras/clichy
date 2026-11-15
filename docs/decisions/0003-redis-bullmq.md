# ADR 0003: Redis and BullMQ for photo jobs

**Status:** Adopted for asynchronous photo processing; operational baseline recorded at `bce6e50`, current live state not checked.

## Context

Uploads need image metadata extraction, hashing, and derivative generation without keeping the HTTP request open during all processing.

## Decision

Use BullMQ backed by Redis. Server creates queue jobs; worker consumes `process-photo`; a PostgreSQL outbox stores publication intent and enables retry/recovery.

## Alternatives considered

No formal comparison is recorded. Synchronous processing was avoided in favor of asynchronous work, based on current architecture.

## Consequences

Retries, backoff, queue identity and recovery behavior are explicit. Redis remains a single instance with AOF/PVC, so it has no configured failover. Shared filesystem access between API and worker is required.
