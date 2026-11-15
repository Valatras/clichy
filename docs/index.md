# Clichy engineering guide

Clichy is a self-hosted photo library service developed for ECAM Brussels Project 2026. This site documents the implementation visible in this repository, the current Kubernetes and CI configuration, and the gaps against the assignment. It is intended for developers, operators, and evaluation preparation.

!!! warning "Repository state, not a live cluster audit"
    Statements about implementation are based on the checked-out source and Git history. Unless explicitly stated, this documentation has not verified the current state of a live cluster. See the [requirements matrix](project/requirements.md) for status definitions.

Start with the [project overview](project/overview.md), then follow [developer onboarding](development/onboarding.md). Operators should read the [Kubernetes environments](infrastructure/kubernetes.md), [deployment runbook](operations/deployment.md), and [database migration guide](database/migrations.md).

The observed checkout is `master` at `2a7717f` (2026-11-15). The app currently contains a web UI, authenticated API, filesystem photo storage, image metadata and hashing, and asynchronous processing. PostgreSQL and Redis are each configured as one instance per namespace. Database replication and sharding are not configured.
