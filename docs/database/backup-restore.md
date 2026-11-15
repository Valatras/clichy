# Database backup and restore

## Repository status

No automated PostgreSQL dump, WAL archive, snapshot schedule, restore script, or documented tested restore procedure is present in the checked-in implementation. Persistent volumes and `Retain` reclaim policy do not constitute a backup. Photo originals also live outside PostgreSQL and must be backed up consistently with their database references.

## Operational requirement

Until a validated procedure exists, treat backup/restore as an open operational gap. Design a coordinated backup covering PostgreSQL and photo storage, define retention and encryption, and test restores into an isolated namespace. Preserve Redis only as appropriate for queue recovery; the database outbox and stale-record recovery are relevant to re-enqueueing work, but are not backups.

Do not run ad hoc destructive recovery commands against Production. A future runbook should record approved tooling, consistency point, secret handling, validation queries, and recovery time/data objectives without storing credentials in the repository.
