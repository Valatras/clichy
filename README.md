# Clichy

Clichy est une photothèque personnelle on-premise développée pour le projet
Distributed Systems de l’ECAM Brussels : authentification, uploads, métadonnées,
aperçus et recherche de photos identiques ou similaires.

React, Fastify, Prisma/PostgreSQL et BullMQ/Redis forment l’application. GitHub
Actions publie les images dans GHCR et déploie sur K3s. Test et Production ciblent
une architecture commune CNPG + Citus : 32 shards logiques et un standby WAL.
La [bascule contrôlée](docs/operations/deployment.md#controlled-cutover) reste
nécessaire sur valtask ; le serveur mono-nœud ne fournit pas de disponibilité
face à une panne physique.

## Quick Start

Avec Node.js 24, pnpm 12.8.1 et Docker Compose :

```bash
pnpm install
pnpm db:start
# Configurer les .env selon le guide local, puis :
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Le [guide local](docs/development/onboarding.md) fournit la configuration, sans
Kubernetes. La [documentation](docs/index.md), le [catalogue des scripts](docs/operations/scripts.md)
et les [décisions d’architecture](docs/decisions/index.md) couvrent le système et ses limites.
