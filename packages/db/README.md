# Clichy Database

Client Prisma, schémas et migrations PostgreSQL de Clichy.

- [Développement local et configuration](../../docs/development/onboarding.md)
- [PostgreSQL, Citus et CNPG](../../docs/infrastructure/databases.md)
- [Migrations et déploiement](../../docs/operations/deployment.md)
- [Tests des migrations](../../docs/development/testing.md)

Les migrations appliquées sont immuables. Toute évolution, y compris le sharding,
se fait dans une nouvelle migration. `docker-compose.yml` sert uniquement au local.
