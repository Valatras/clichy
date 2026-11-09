# Base de données

Ce package centralise le schéma Prisma, le client généré et la configuration
PostgreSQL. Le schéma se trouve dans `prisma/schema/` et les migrations
versionnées dans `prisma/migrations/`.

## PostgreSQL local

Depuis la racine du dépôt :

```bash
pnpm run db:start
```

Compose démarre PostgreSQL 18 sur `localhost:5432` avec la base locale
`clichy`. Les identifiants par défaut dans `docker-compose.yml` sont réservés
au développement local ; ne pas les réutiliser sur un serveur accessible à
d'autres machines.

## Générer et appliquer les migrations

Après une modification du schéma, créer une migration pendant le
développement :

```bash
pnpm run db:migrate
```

Cette commande utilise la `DATABASE_URL` de développement et crée un nouveau
répertoire SQL dans `prisma/migrations/`. Vérifier puis committer la migration.
Le dépôt ne contient pas encore de migration initiale : en créer une avant de
déployer sur une base vierge.

Les environnements persistants appliquent uniquement les migrations
commitées :

```bash
pnpm --filter @clichy/db db:migrate:deploy
```

Le workflow GitHub Actions exécute cette commande sur Test avant le rollout.
Une migration ajoutée doit être compatible avec les données et le code déjà
déployés ; ne pas utiliser `db:push` ou `db:reset` sur Test/Prod.

## Autres commandes

| Commande | Description |
| --- | --- |
| `pnpm run db:generate` | Génère le client Prisma après changement du schéma |
| `pnpm run db:studio` | Ouvre Prisma Studio |
| `pnpm run db:stop` | Arrête le conteneur local sans supprimer les données |
| `pnpm run db:down` | Supprime les conteneurs et le réseau Compose, sans supprimer le volume |

Les données locales du volume Compose restent après `db:down`. Pour supprimer
explicitement les données locales, `docker compose down --volumes` depuis
`packages/db/` les efface. Les volumes Kubernetes sont indépendants et ne
doivent pas être supprimés pour résoudre un problème de migration.
