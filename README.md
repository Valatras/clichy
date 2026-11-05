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

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

Generate the Prisma client before development, typechecking, or building, including in CI and deployment builds. Run this again after changing the Prisma schema:

```bash
pnpm run db:generate
```

This project uses PostgreSQL with Prisma.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the committed Prisma migrations to your database:

```bash
pnpm --filter @clichy/db db:migrate:deploy
```

For persistent environments, use `prisma migrate deploy` rather than `db:push`. Supply `DATABASE_URL` through a secure environment or secret manager; do not commit it. Create new migrations during development with `pnpm run db:migrate`.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Kubernetes Databases

The Kubernetes environments use isolated databases and Secrets. The PostgreSQL Service listens on port `5432` inside each namespace.

For Headlamp access, Kubernetes scaling, and monitoring operations, see the
[administrator Headlamp guide](./infra/kubernetes/administrator_headlamp_guide.md).

| Environment | Namespace | Database | Local port-forward | Status |
| --- | --- | --- | --- | --- |
| Dev | `clichy-dev` | `clichy_dev` | `25432` | Configured |
| Test | `clichy-test` | `clichy_test` | `25433` | Configured |
| Prod | `clichy-prod` | `clichy_prod` | `25434` | Not deployed; provision a Secret and confirm the production hostname/TLS first |

Each configured namespace needs a `clichy-server-secrets` Secret with `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `BETTER_AUTH_SECRET`. Keep these values outside Git. `DATABASE_URL` must use that environment's credentials and database name, with reserved password characters URL-encoded. Changing `POSTGRES_DB` does not create or rename a database in an already-initialized PostgreSQL volume.

## Preparing a k3s cluster

The manifests are in `infra/kubernetes/overlays/`. The `dev` overlay uses the k3s default `local-path` StorageClass for PostgreSQL and photos and expects the default Traefik ingress controller. These defaults are suitable for a single-node development cluster; the node-local volumes are not a backup or high-availability solution.

### Select the k3s context

On the k3s server, verify the cluster, storage class, and Traefik installation:

```bash
sudo k3s kubectl get nodes
sudo k3s kubectl get storageclass
sudo k3s kubectl get pods -n kube-system | grep traefik
```

On the k3s server, create a dedicated kubeconfig rather than overwriting the Docker Desktop context:

```bash
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/clichy-k3s.yaml"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/clichy-k3s.yaml"
chmod 600 "$HOME/.kube/clichy-k3s.yaml"
```

If kubectl will run from another machine, securely transfer this kubeconfig to that machine first. If connecting remotely, replace its `127.0.0.1` API address with the k3s server's reachable IP, then select and verify this dedicated config:

```bash
K3S_SERVER_IP=192.0.2.10 # Replace with the k3s server's reachable IP.
KUBECONFIG="$HOME/.kube/clichy-k3s.yaml" kubectl config set-cluster default \
  --server="https://${K3S_SERVER_IP}:6443"
export KUBECONFIG="$HOME/.kube/clichy-k3s.yaml"
kubectl config current-context
kubectl get nodes
```

Do not continue unless `kubectl config current-context` and `kubectl get nodes` identify k3s. Protect this kubeconfig: it grants cluster-admin access.

### Create namespace-local secrets

The application and private GHCR images both need Secrets in the target namespace. Do this once per namespace (here, `clichy-dev`) before applying its overlay:

```bash
kubectl apply -f infra/kubernetes/overlays/dev/namespace.yaml

mkdir -p "$HOME/.config/clichy"
chmod 700 "$HOME/.config/clichy"
umask 077
touch "$HOME/.config/clichy/dev-secrets.env"
chmod 600 "$HOME/.config/clichy/dev-secrets.env"
```

Edit `$HOME/.config/clichy/dev-secrets.env` with the five required key/value pairs: `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `BETTER_AUTH_SECRET`. Use `clichy-postgres` as the database host and `clichy_dev` as the dev database name. Generate a unique auth secret (for example, `openssl rand -base64 32`); URL-encode reserved characters in the database password within `DATABASE_URL`. Keep this file outside the repository.

Then create or update the Kubernetes Secret:

```bash
set -o pipefail
kubectl create secret generic clichy-server-secrets \
  --namespace=clichy-dev \
  --from-env-file="$HOME/.config/clichy/dev-secrets.env" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create the GHCR pull Secret using a GitHub token authorized to read the `valatras/clichy-server` and `valatras/clichy-web` packages. The token is read without echoing and piped to kubectl rather than passed as a command-line argument:


```bash
(
set -o pipefail
read -rp "GitHub username: " GHCR_USERNAME
read -srp "GHCR read:packages token: " GHCR_TOKEN
printf "\n"
printf "%s" "$GHCR_TOKEN" |
  GHCR_USERNAME="$GHCR_USERNAME" python3 -c '
import base64, json, os, sys
username = os.environ["GHCR_USERNAME"]
token = sys.stdin.read()
auth = base64.b64encode(f"{username}:{token}".encode()).decode()
json.dump({"auths": {"ghcr.io": {
    "username": username, "password": token, "auth": auth
}}}, sys.stdout)
' |
  kubectl create secret generic ghcr-pull-secret \
    --namespace=clichy-dev \
    --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson=/dev/stdin \
    --dry-run=client -o yaml |
  kubectl apply -f -
)
```

Do not enable shell tracing (`set -x`) while entering credentials. `imagePullSecrets` is configured for the server and web Deployments in the `dev`, `test`, and `prod` overlays; create `ghcr-pull-secret` separately in every namespace you deploy.

### Deploy Dev

The CI workflow publishes immutable `sha-<commit>` tags to GHCR. Set `IMAGE_TAG` to a tag from a successful `master` workflow run:

```bash
kubectl apply -k infra/kubernetes/overlays/dev
export IMAGE_TAG=sha-REPLACE_WITH_COMMIT_SHA
kubectl set image deployment/clichy-server \
  server="ghcr.io/valatras/clichy-server:${IMAGE_TAG}" -n clichy-dev
kubectl set image deployment/clichy-web \
  web="ghcr.io/valatras/clichy-web:${IMAGE_TAG}" -n clichy-dev
kubectl rollout status deployment/clichy-server -n clichy-dev --timeout=180s
kubectl rollout status deployment/clichy-web -n clichy-dev --timeout=180s
kubectl get pods,ingress,pvc -n clichy-dev
unset IMAGE_TAG
```

The overlay serves HTTP on `clichy.localhost`. For access from another machine, point that hostname to the k3s node's IP (for example, add `<K3S_SERVER_IP> clichy.localhost` to the client's hosts file) and allow inbound HTTP to the node. `localhost` by itself resolves to the client machine, not a remote k3s node.

### Connect and migrate Dev or Test

In a first terminal, start a port-forward for the environment. For Dev:

```bash
kubectl port-forward -n clichy-dev svc/clichy-postgres 25432:5432
```

For Test, use `kubectl port-forward -n clichy-test svc/clichy-postgres 25433:5432`.

In a second terminal, set the namespace and matching local port. The command below reads credentials directly from the Kubernetes Secret, rewrites only the connection host/port, and does not print the URL:

```bash
export NAMESPACE=clichy-test
export LOCAL_PORT=25433
export DATABASE_URL="$(
  kubectl get secret clichy-server-secrets -n "$NAMESPACE" -o json |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const data = JSON.parse(input).data;
        const decode = key => Buffer.from(data[key], "base64").toString("utf8");
        const url = new URL(decode("DATABASE_URL"));
        url.hostname = "127.0.0.1";
        url.port = process.env.LOCAL_PORT;
        url.username = decode("POSTGRES_USER");
        url.password = decode("POSTGRES_PASSWORD");
        url.pathname = "/" + decode("POSTGRES_DB");
        if (!url.searchParams.has("schema")) url.searchParams.set("schema", "public");
        process.stdout.write(url.toString());
      });
    '
)"
```

Connect with `psql "$DATABASE_URL"` or apply the checked-in Prisma migrations:

```bash
pnpm --filter @clichy/db db:migrate:deploy
unset DATABASE_URL NAMESPACE LOCAL_PORT
```

Use `NAMESPACE=clichy-dev` and `LOCAL_PORT=25432` for Dev. Prod is not currently provisioned in the cluster; do not use the example hostname in its overlay as a real production endpoint. Before enabling it, create a namespace-local Secret, configure the real hostname and TLS, then deploy its overlay and use local port `25434` for access.

The Test API currently mounts the existing `clichy-server-photos` PVC as a temporary fallback. The overlay's NFS PV refers to host `valtask`, which the Kubernetes node cannot resolve. Reapplying the Test overlay will restore that broken NFS claim; configure a resolvable NFS host before doing so. No PV, PVC, or photo data was changed for the database reset.

The CI deployment does not run migrations. `db:migrate:deploy` runs `prisma migrate deploy` and applies committed migrations without resetting data. Create migrations during development with `pnpm run db:migrate`; do not use `db:push` for persistent environments.

See the [Kubernetes administration, autoscaling, and monitoring guide](./infra/kubernetes/README.md) for Headlamp, Test HPAs, the Clichy Grafana dashboard, Prometheus alert rules, and cluster operation commands.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@clichy/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Project Structure

```
clichy/
├── apps/
│   ├── web/         # Frontend application (React + React Router)
│   └── server/      # Backend API (Fastify)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm --filter @clichy/db db:migrate:deploy`: Apply committed Prisma migrations
- `pnpm run db:migrate`: Create and apply a migration during development
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:studio`: Open database studio UI

## Better Auth Schema Generation

After changing auth plugins or schema options, run `pnpm run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
