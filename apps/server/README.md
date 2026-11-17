# API Clichy

Fastify, Better Auth et dispatcher d’outbox sur le port 3000.

- [Configuration et lancement](../../docs/development/onboarding.md)
- [Routes et traitement des photos](../../docs/architecture/application.md)
- [Tests](../../docs/development/testing.md)

Points d’entrée : `src/index.ts`, `src/routes/photos.ts`,
`src/queues/outbox-dispatcher.ts`, `src/storage.ts` et `src/image-processing.ts`.
Le Dockerfile de production est `infra/docker_clichy_server/Dockerfile`.
