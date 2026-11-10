# API Clichy

L'API utilise Fastify et écoute sur `0.0.0.0:3000`. Elle fournit les routes
d'authentification Better Auth (`/api/auth/*`), les opérations de photos et
l'endpoint de métriques Prometheus (`/metrics`). En Kubernetes, l'Ingress ne
route que les chemins nécessaires à l'application ; `/metrics` reste interne
au cluster.

## Développement

Depuis la racine du dépôt, configurer `apps/server/.env` comme indiqué dans le
[README principal](../../README.md#démarrage-local), démarrer PostgreSQL,
puis lancer :

```bash
pnpm run dev:server
pnpm --filter server test
```

Le schéma d'environnement est défini dans `.env.schema`. Après l'avoir modifié,
régénérer les types avec `pnpm run env:generate`.

## Images et déploiement

Le [Dockerfile](../../infra/docker_clichy_server/Dockerfile) produit une image
Node.js autonome. L'application attend `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` et `CORS_ORIGIN`. `PHOTO_STORAGE_PATH` pointe vers le
répertoire persistant des fichiers ; en Kubernetes, il vaut `/data/photos`.

Le déploiement K3s et les migrations sont décrits dans
[`infra/kubernetes/README.md`](../../infra/kubernetes/README.md). Les médias
stockés dans le volume local ne sont pas inclus dans l'image ni dans la base
PostgreSQL ; sauvegarder les deux séparément.
