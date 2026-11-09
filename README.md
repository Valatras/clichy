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

## La stack technique

Le projet s'articule autour de trois grandes catégories : l'application, l'infrastructure et le déploiement.

### Application

Les technologies utilisées pour développer l'application et gérer ses différents services :

- **TypeScript** — Langage principal, pour bénéficier du typage statique et d'une meilleure expérience de développement.
- **React** — Bibliothèque utilisée pour construire l'interface utilisateur.
- **React Router** — Gestion du routage de l'application.
- **TailwindCSS** — Framework CSS utilitaire pour construire rapidement l'interface.
- **shadcn/ui** — Primitives et composants d'interface partagés dans le package `packages/ui`.
- **Fastify** — Framework backend léger et performant pour exposer l'API.
- **Node.js** — Environnement d'exécution JavaScript côté serveur.
- **Prisma** — ORM permettant de gérer les interactions avec la base de données.
- **PostgreSQL** — Base de données relationnelle.
- **Better Auth** — Gestion de l'authentification.
- **Redis** — Utilisé notamment pour la gestion des tâches en arrière-plan.
- **BullMQ** — Gestion des files de tâches et des workers.
- **Turborepo** — Gestion du monorepo et optimisation des tâches de build.

### Infrastructure

Les technologies utilisées pour déployer et faire fonctionner l'application :

- **K3s / Kubernetes** — Orchestration des conteneurs sur une machine Linux. J'ai pris k3s car il est très light et que je n'ai pas énormément de ressources sur la machine qui l'héberge... 😅
- **Traefik** — Ingress Controller permettant de router le trafic vers les différents services du cluster.
- **Docker** — Construction et distribution des images des applications.
- **Prometheus** — Collecte et stockage des métriques de l'infrastructure.
- **Grafana** — Visualisation des métriques et suivi de l'état des services.
- **Headlamp** — Interface web permettant de visualiser et de gérer les ressources Kubernetes, notamment le scaling manuel des applications.

### Déploiement et outils

Les outils utilisés pour automatiser le développement, les déploiements et documenter le projet :

- **Git** — Gestion du versioning.
- **GitHub Actions** — Automatisation des workflows CI/CD : tests, builds et déploiements.
- **GitHub Wiki** — Documentation technique détaillée du projet.
- **Cloudflare Tunnel** — Exposition sécurisée des services sur Internet, sans ouverture de ports entrants sur le routeur domestique.

---

*Ce projet évolue au fil de mes expérimentations et de mes apprentissages. Certaines fonctionnalités et certains choix d'architecture sont donc susceptibles d'évoluer. Aussi il est voué à ne plus être déployé sur internet une fois l'évaluation terminé.*


## Architecture

- [`apps/web/`](./apps/web/README.md) : interface React avec React Router.
- [`apps/server/`](./apps/server/README.md) : API Fastify pour l'authentification,
  les photos et les métriques.
- [`packages/db/`](./packages/db/README.md) : schéma Prisma et PostgreSQL.
- [`infra/`](./infra/README.md) : images Docker, manifests Kubernetes et outils
  de déploiement.

Le dépôt est un monorepo pnpm orchestré par Turborepo. En développement, le
frontend écoute sur `http://localhost:5173`, l'API sur
`http://localhost:3000` et PostgreSQL sur le port `5432`.

## Développement local

Prérequis : Git, Node.js 24, pnpm 12 et Docker avec Compose.

```bash
pnpm install
pnpm run db:start
```

Créer `apps/server/.env` (ne pas le committer) avec les valeurs de
développement suivantes, en remplaçant le secret par une valeur aléatoire d'au
moins 32 caractères :

```dotenv
NODE_ENV=development
BETTER_AUTH_SECRET=remplacer-par-une-cle-aleatoire-d-au-moins-32-caracteres
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:password@localhost:5432/clichy?schema=public
PHOTO_STORAGE_PATH=./data/photos
```

Créer aussi `apps/web/.env` :

```dotenv
NODE_ENV=development
VITE_SERVER_URL=http://localhost:3000
```

Après avoir créé les fichiers d'environnement, générer le client Prisma :

```bash
pnpm run db:generate
```

Le dépôt ne fournit pas encore de migration initiale. Lors de la première
installation sur une base vide, créer cette migration puis la committer avant
de lancer l'application :

```bash
pnpm run db:migrate
```

Ensuite, démarrer l'application :

```bash
pnpm run dev
```

Les scripts de base de données et leur usage sont décrits dans
[`packages/db/README.md`](./packages/db/README.md).

## Déploiement sur un serveur domestique

Le déploiement cible un serveur Linux exécutant K3s. Le parcours conseillé est
de pousser sur `master` : GitHub Actions vérifie et construit le projet, publie
les images dans GHCR, puis déploie l'environnement Test sur le serveur à l'aide
d'un runner GitHub Actions auto-hébergé.

1. Installer K3s, Helm et la stack Prometheus sur le serveur.
2. Créer les secrets Kubernetes hors du dépôt avec le script de préparation.
3. Enregistrer un runner Linux auto-hébergé sur le dépôt GitHub et lui donner
   accès à `kubectl`, Docker et pnpm.
4. Pousser les changements sur `master`. Le workflow déploie Test après la
   construction et l'application des migrations.

Le guide complet, les commandes et les limites de cette configuration sont
dans [`infra/kubernetes/README.md`](./infra/kubernetes/README.md). Pour déployer
manuellement une image déjà publiée :

```bash
./infra/kubernetes/scripts/deploy.sh dev sha-<sha-du-commit>
```

Le domaine et Cloudflare Tunnel ne sont pas configurés par le dépôt. Les
overlays actuels utilisent des noms de développement ; ne pas exposer
l'interface Kubernetes, PostgreSQL ou Prometheus sur Internet. Préparer
l'Ingress, les URL d'authentification/CORS et le routage du tunnel avant
d'utiliser un vrai nom de domaine.

## Commandes pnpm utiles

| Commande | Description |
| --- | --- |
| `pnpm run dev` | Démarre les applications en développement |
| `pnpm run build` | Construit les applications |
| `pnpm run check-types` | Vérifie les types TypeScript |
| `pnpm --filter server test` | Lance les tests du serveur |
| `pnpm run db:start` | Démarre PostgreSQL avec Docker Compose |
| `pnpm run db:generate` | Génère le client Prisma |
| `pnpm run db:migrate` | Crée une migration de développement |
| `pnpm --filter @clichy/db db:migrate:deploy` | Applique les migrations validées |

`db:push` et `db:reset` sont réservés au développement local : ne pas les
utiliser sur une base persistante.
