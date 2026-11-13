# Clichy

## Quelques mots sur le projet

Clichy est un projet scolaire réalisé dans le cadre de mon cours de **Distributed Systems à l'ECAM Brussels**.

L'objectif de ce projet était avant tout de mieux comprendre les systèmes distribués, de découvrir l'orchestration avec Kubernetes et d'apprendre à utiliser les différents outils permettant de déployer, surveiller et maintenir une application dans une infrastructure réelle.

Au-delà du développement de l'application elle-même, j'ai voulu profiter de ce projet pour explorer plusieurs concepts et technologies que l'on retrouve dans les infrastructures modernes :

- La création et la gestion d'images avec Docker.
- L'orchestration de conteneurs avec Kubernetes : Pods, Deployments, StatefulSets, Services, Ingress, etc.
- La gestion du stockage persistant et des bases de données.
- La mise en place d'une chaîne CI/CD pour automatiser les tests et les déploiements.
- Le monitoring de l'infrastructure, la collecte de métriques et la configuration d'alertes.
- L'exposition d'une application sur Internet à travers Cloudflare Tunnel et un nom de domaine, sans avoir à exposer directement mon réseau domestique.

Un **Wiki** accompagne le projet afin de documenter plus en détail son architecture, les choix techniques et les différentes étapes de mise en place de l'infrastructure.

## Mais concrètement, qu'est-ce que Clichy ?

Clichy est une application web de gestion de photos et de vidéos, dans l'esprit de Google Photos.

Son objectif est simple : **aider à optimiser l'espace de stockage occupé par nos photos et vidéos**, en identifiant les fichiers inutiles ou redondants qui finissent souvent par s'accumuler au fil du temps.

Les solutions grand public comme Google Photos ou Apple Photos proposent déjà de nombreuses fonctionnalités de gestion et de recherche. Cependant, elles ne mettent pas nécessairement l'accent sur la détection et la suppression des redondances de manière aussi poussée que je le souhaiterais.

C'est là que Clichy intervient. Pensé pour être déployé sur une infrastructure *on-premise* (sur site), il permet de garder le contrôle sur ses données tout en cherchant à identifier différents types de redondances :

- **Photos dupliquées** : les mêmes photos téléchargées ou importées plusieurs fois.
- **Photos similaires** : les nombreuses prises de vue d'une même scène, souvent réalisées dans l'espoir de trouver « la prise parfaite ».
- **Photos floues** : les clichés dont la qualité est insuffisante et qui finissent souvent oubliés dans nos albums.

L'idée n'est pas simplement de stocker ses photos ailleurs, mais de disposer d'un outil permettant de mieux gérer sa collection et d'éviter de gaspiller inutilement son espace de stockage.


## Technologies

- **Application :** TypeScript, React, React Router, Fastify, Better Auth,
  Prisma et PostgreSQL.
- **Monorepo :** pnpm et Turborepo.
- **Déploiement :** images OCI construites avec Docker par GitHub Actions,
  publiées dans GHCR et exécutées sur K3s avec Traefik.
- **Administration et monitoring :** Headlamp, Prometheus et Grafana.
- **Accès :** Test et administration privés via LAN/Tailscale ; Prod via
  Cloudflare Tunnel à `https://valtask.xyz`.

Redis et BullMQ ne font pas partie du déploiement actuel. Cloudflare Tunnel
est configuré extérieurement au dépôt pour l'accès public de production ;
aucun service d'administration n'est exposé par ce tunnel.

## Démarrage local

Prérequis : Node.js 24, pnpm 12.8.1 et Docker Compose pour la base locale.
Depuis la racine :

```bash
pnpm install
pnpm run db:start
```

Configurer `apps/server/.env` avec les valeurs de développement :

```dotenv
NODE_ENV=development
BETTER_AUTH_SECRET=une-cle-aleatoire-d-au-moins-32-caracteres
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:password@localhost:5432/clichy?schema=public
PHOTO_STORAGE_PATH=./data/photos
```

Configurer `apps/web/.env` :

```dotenv
NODE_ENV=development
VITE_SERVER_URL=http://localhost:3000
```

Puis générer le client Prisma, appliquer les migrations locales et démarrer
l'application :

```bash
pnpm run db:generate
pnpm run db:migrate
pnpm run dev
```

L'interface de développement est disponible sur `http://localhost:5173` et
l'API sur `http://localhost:3000`. Ne pas réutiliser les identifiants Compose
sur un serveur. Voir les README de [l'API](./apps/server/README.md), du
[frontend](./apps/web/README.md) et de la [base de données](./packages/db/README.md).

## Infrastructure

Le guide d'installation complet pour Ubuntu Server, K3s, Tailscale, Traefik,
Helm, le runner GitHub Actions, le stockage, le monitoring et le dépannage se
trouve dans [infra/kubernetes/README.md](./infra/kubernetes/README.md).

Les environnements `dev`, `test` et `prod` ont des overlays distincts. Dev
reste local, Test est privé sur `valtask` et le manifeste Prod cible
`https://valtask.xyz`. Sur un push validé vers `master`, le workflow déploie
Test puis attend l'approbation de l'environnement GitHub `production` avant
d'appliquer les migrations et de déployer le même SHA en Prod.

L'incident de migration Prod résolu et les consignes de récupération sont
consignés dans [docs/operations/known-issues.md](./docs/operations/known-issues.md).
