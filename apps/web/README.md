# Interface web Clichy

L'interface utilise React, React Router et Tailwind CSS. En développement,
elle écoute sur `http://localhost:5173` et appelle les routes API via le même
hôte d'origine (`/api/auth`, `/photos`).

## Développement

Configurer `apps/web/.env` comme indiqué dans le
[README principal](../../README.md#développement-local), puis lancer depuis la
racine :

```bash
pnpm run dev:web
```

Le schéma des variables est dans `.env.schema`. L'image de déploiement est
construite par
[`infra/docker_clichy_web/Dockerfile`](../../infra/docker_clichy_web/Dockerfile).
Les routes publiques et le déploiement K3s sont détaillés dans le
[guide d'infrastructure](../../infra/kubernetes/README.md).

Les composants d'interface partagés sont dans [`packages/ui/`](../../packages/ui/).

Pour le test privé via Tailscale, le header contient provisoirement des liens
vers Grafana (`http://valtask:3000`) et Headlamp (`http://valtask:4466`). Ils
supposent que le nom `valtask` résout vers le serveur et que les entrypoints
Traefik LAN sont configurés comme indiqué dans le
[guide K3s](../../infra/kubernetes/README.md#accès-de-test-par-tailscale).
