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
