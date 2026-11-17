# Clichy engineering guide

Clichy is a self-hosted photo library service developed for ECAM Brussels Project 2026. This site documents the implementation visible in this repository, the current Kubernetes and CI configuration, and the gaps against the assignment. It is intended for developers, operators, and evaluation preparation.

!!! warning "Repository state, not a live cluster audit"
    Statements about implementation are based on the checked-out source and Git history. Unless explicitly stated, this documentation has not verified the current state of a live cluster. See the [requirements matrix](project/requirements.md) for status definitions.

Start with the [project overview](project/overview.md), then follow [developer onboarding](development/onboarding.md). Operators should read the [Kubernetes environments](infrastructure/kubernetes.md), [deployment runbook](operations/deployment.md), and [database migration guide](database/migrations.md).

The source review is based on the checked-out repository; the application contains a web UI, authenticated API, filesystem photo storage, image metadata and hashing, and asynchronous processing. CNPG is configured in repository manifests for two PostgreSQL instances per environment, but installation, replication and failover on `valtask` have not been verified. Redis remains one instance per namespace. Test uses a separate single-Pod Citus database with 32 logical shards per photo/outbox table; Dev and Production use CNPG without Citus. Production traffic is proxied by Cloudflare for `valtask.xyz` and `www.valtask.xyz` and delivered to the server through Cloudflare Tunnel before Traefik.

For routine environment checks, use the [read-only healthcheck](operations/healthchecks.md).

Pour la présentation, suivre la [routine de démo devant le professeur](operations/demo.md).
