# Roadmap and development status

## Evidence-based progression

Git history shows a foundation and application development, followed by image hashing, Redis/BullMQ work, Kubernetes and monitoring changes, and a database migration/deployment repair. Not every historical experiment is part of the current runtime.

| Stage | Verified status |
|---|---|
| 1. Foundation | Historical; initial structure and local development are present. Exact completion criteria are not defined in current docs. |
| 2. Authentication and storage | Implemented: Better Auth/Prisma, per-user photo records, filesystem originals and derivatives. |
| 3. Image processing | Implemented baseline: EXIF extraction, dimensions, SHA-256, pHash, Hamming distance, WebP derivatives. Broader automated curation UX is incomplete/unverified. |
| 4. Containerization | Dockerfiles exist for web/server/worker; compose exists for PostgreSQL and Redis. |
| 5. Kubernetes | Kustomize base/overlays, K3s scripts, Ingress and storage manifests exist. Live cluster state is outside source review. |
| 6. Asynchronous processing | Functional baseline intended at `bce6e50`; current source has BullMQ worker, retry settings, DB outbox and stale-job recovery. Current live operation is unverified. |
| 7. Infrastructure and deployment improvements | In progress: exact-SHA CI/CD, pre-deploy Prisma migrations, environment secrets, prod storage config, monitoring. Recent commits are still changing this area. |
| 8. Paused stage | On hold per project context. Exact stage name is not present in the checked-in plan/docs available in this checkout. |
| 9. Paused stage | On hold per project context. Exact stage name is not present in the checked-in plan/docs available in this checkout. |

The project plan naming for stages 8 and 9 could not be verified in repository files or recent commit messages. These entries intentionally retain neutral labels rather than inventing names. No paused work is described as complete.

## Current baseline

The checked-out head is `2a7717f` (`fix: ensure PostgreSQL data directory permissions are correctly set for UID 999`), not `bce6e50`. The latter is a historical checkpoint titled “Using Redis and BullMQ for workers queue and Recovery, claiming photos atomically and processes originals from shared storage.” Current head includes later PostgreSQL structure, local storage, and permissions changes.
