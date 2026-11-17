# Clichy

Clichy is an on-premise photo library built for the ECAM Brussels Distributed
Systems project. It provides authenticated uploads, original/preview access,
metadata extraction and exact/perceptual duplicate queries. Video processing
and automatic blurry-photo detection are not implemented.

Start with [local setup](development/onboarding.md); Kubernetes is not needed
for application development. Use [testing](development/testing.md) before
submitting a change, and the [scripts catalogue](operations/scripts.md) to
operate an environment.

## Find your way

| Need | Read |
| --- | --- |
| Understand components | [Architecture](architecture/overview.md) and [application flow](architecture/application.md) |
| Understand public/private access | [Networking](architecture/networking.md) |
| Prepare the server | [Kubernetes](infrastructure/kubernetes.md) |
| Follow a commit into Test/Production | [CI/CD](infrastructure/ci-cd.md) |
| Understand Citus and replication | [Databases](infrastructure/databases.md) |
| Observe load and scale | [Monitoring](infrastructure/monitoring.md) |
| Update an environment | [Deployment and migrations](operations/deployment.md) |
| Investigate a failure | [Troubleshooting](operations/troubleshooting.md) |
| Decode a term | [Glossary](glossary.md) |

## Scope and academic evaluation

The cluster intentionally runs on one host, `valtask`. Configuration in Git
is not proof of live operation; capture workflow runs and healthcheck output
when demonstrating it.

| Requirement | Implementation and remaining evidence |
| --- | --- |
| Tests, images and automatic Test deployment | GitHub Actions tests/builds; GHCR SHA tags; self-hosted Test runner |
| Production promotion and migrations | Manual dispatch after Test; migrations before application rollout; GitHub environment protection depends on repository settings |
| Sharding | Target Test/Prod CNPG+Citus: `userId`, 32 colocated Photo/outbox shards; controlled cutover pending |
| Replication | CNPG: two instances; pre-cutover streaming confirmed by operator output; unified CNPG failover still needs a controlled test |
| Rolling updates and scaling | Deployments and Test API/Web HPA; zero downtime and scaling require measurements |
| Monitoring | Prometheus, API/worker/CNPG metrics and Grafana dashboard; verify scrape health |
| Isolation and ingress | Namespace-specific Secrets, Redis and storage; Traefik routes UI/API; Production tunnel is configured outside Git |
| Known gaps | No tested backup/restore automation, Test refresh/anonymization or replicated Redis; all data shares one physical host |
