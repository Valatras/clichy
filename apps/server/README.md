# API Clichy

L'API utilise Fastify et écoute sur `0.0.0.0:3000`. Elle fournit les routes
d'authentification Better Auth (`/api/auth/*`), les opérations de photos et
l'endpoint de métriques Prometheus (`/metrics`). En Kubernetes, l'Ingress ne
route que les chemins nécessaires à l'application ; `/metrics` reste interne
au cluster.

## Développement

Depuis la racine du dépôt, configurer `apps/server/.env` comme indiqué dans le
[README principal](../../README.md#démarrage-local), démarrer PostgreSQL,
puis lancer l'API et le worker dans deux terminaux :

```bash
pnpm run dev:server
pnpm run dev:worker
pnpm --filter server test
```

Le worker utilise `apps/worker/.env`; configurez-y le même `DATABASE_URL`,
Redis et le même chemin photo que le serveur.

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

## Traitement asynchrone des images

L'API valide l'image, écrit l'original puis crée le `Photo` (`PENDING`) et un
événement `PhotoProcessingOutbox` dans une transaction PostgreSQL. La route
répond `202 Accepted`; elle ne lance pas Sharp. Le dispatcher de
`src/queues/outbox-dispatcher.ts` publie les événements dans BullMQ et ne les
marque publiés qu'après acceptation par Redis. En cas d'indisponibilité de
Redis, l'événement durable reste disponible et sera retenté.

Le worker autonome de `apps/worker` consomme `process-photo`. Son payload ne
contient que `photoId`; il relit l'original via `PHOTO_STORAGE_PATH`, exécute
les fonctions partagées de `src/image-processing.ts` et écrit les mêmes
métadonnées, hash SHA-256, pHash et dérivés idempotents. Les originaux restent
inchangés et les dérivés sont atomiquement remplacés.

La file applique quatre tentatives par défaut avec backoff exponentiel à partir
de 2 secondes. Les erreurs d'accès transitoires reviennent à `PENDING` entre
les tentatives; les images invalides et fichiers originaux manquants passent à
`FAILED` immédiatement. Après épuisement des tentatives, le statut devient
`FAILED` et l'erreur est enregistrée. Les jobs terminés sont conservés au plus
24 heures/1000 éléments et les jobs échoués 7 jours/5000 éléments.

Le dispatcher récupère les lignes `PROCESSING` âgées de 15 minutes et les
photos `PENDING` sans événement récent. Les événements publiés sont purgés
après 7 jours. Le backfill peut être relancé sans traiter les images dans le
processus API; il crée des événements d'outbox par lots de 100. Il ignore les
photos en cours de suppression ou de traitement.

La suppression définit d'abord un marqueur `deletingAt` par mise à jour
conditionnelle, ce qui empêche un worker en attente de réclamer la photo. Une
suppression concurrente avec un traitement déjà démarré reste refusée par
`409`; les jobs tardifs ignorent les lignes supprimées. Les vérifications de
propriété sont conservées.

Sharp valide le contenu décodé (JPEG, PNG, WebP ou GIF), sans faire confiance au
MIME ou à l'extension fournis par le client. Les uploads restent plafonnés à
20 MiB par Fastify, les images à 40 millions de pixels et Sharp à un thread
interne. Le worker Kubernetes démarre avec une concurrence de 1; la valeur
configurable est limitée à 1 ou 2.

Les originaux existants gardent leur chemin historique
`<PHOTO_STORAGE_PATH>/<user-id>/<uuid>.<extension>`. Les dérivés WebP sont
séparés et ont des chemins stables reconstruits à partir de l'identifiant de
la photo :

| Variante | Côté maximum | Usage |
| --- | ---: | --- |
| `thumbnail` | 256 px | Galerie |
| `medium` | 1024 px | Aperçu standard |
| `large` | 2048 px | Aperçu haute résolution |

Par exemple, une miniature se trouve dans
`<PHOTO_STORAGE_PATH>/derivatives/<photo-id>/thumbnail.webp`. Le stockage
atomique à cette clé fixe rend la génération répétable et permet de régénérer
un dérivé manquant sans modifier l'original.

Chaque image conserve son SHA-256 des octets originaux pour la détection exacte
de doublons. Le pHash est un hash perceptuel 64 bits calculé sur l'image
décodée après correction d'orientation. Contrairement au SHA-256, il peut
rester proche pour des images visuellement proches malgré un redimensionnement
ou une recompression. La distance de Hamming compte les bits différents sur
64; une distance plus faible indique une plus grande proximité, mais ce n'est
pas une mesure universelle de similarité.

Les colonnes PostgreSQL contiennent format, dimensions, orientation, date EXIF,
appareil photo, exposition, ouverture, ISO, longueur focale et coordonnées GPS
optionnelles. Le GPS et les autres métadonnées de détail ne sont renvoyés que
par les routes authentifiées et propriétaires; aucun chemin local n'est exposé.
Le statut de traitement est `PENDING`, `PROCESSING`, `COMPLETED` ou `FAILED`.
Le MIME et la taille persistés sont dérivés du contenu détecté et des octets
originaux.

Toutes les routes photos requièrent une session et vérifient la propriété :

| Route | Résultat |
| --- | --- |
| `GET /photos/:id/metadata` | Informations techniques et EXIF |
| `GET /photos/:id/thumbnail/:variant` | Dérivé `thumbnail`, `medium` ou `large` |
| `GET /photos/:id/duplicates` | Autres photos de la bibliothèque avec le même SHA-256 |
| `GET /photos/:id/similar?threshold=14&limit=10` | Plus proches pHashes, avec distances de Hamming |

Le seuil de similarité est configurable par requête entre 0 et 64 bits; sa
valeur par défaut de 14 est un compromis initial couvrant les cas de
redimensionnement et de recompression testés. Il doit être ajusté aux images et
aux préférences de chaque bibliothèque, et n'est pas une frontière sémantique
garantie.
La recherche compare au départ tous les pHashes de l'utilisateur en mémoire,
puis trie les résultats. Elle est linéaire en nombre de photos et devra être
optimisée pour de très grandes bibliothèques. Elle ne lit jamais les hashes
d'autres utilisateurs.

### Traiter les photos préexistantes et récupérer des échecs

Après application de la migration, reconstruire le serveur puis lancer le
backfill. Il examine les lignes par lots, ignore les photos terminées par la
version courante dont les trois dérivés sont présents, et ajoute des événements
d'outbox pour les autres. Le worker doit être démarré pour effectuer le
traitement :

```bash
pnpm --filter @clichy/db db:migrate
pnpm --filter server build
pnpm --filter server backfill:photos
```

Le processus a besoin du même `DATABASE_URL` et `PHOTO_STORAGE_PATH` que le
serveur. En production, exécuter le script compilé depuis un Pod serveur afin
qu'il partage le volume photo :

```bash
node dist/scripts/backfill-photos.mjs
```

Le script affiche les photos ajoutées à la file, ignorées et les erreurs, et
retourne un code non nul si des enregistrements n'ont pas pu être inspectés ou
mis en file. Les échecs finaux de traitement sont visibles sur `Photo` via
`processingStatus` et `processingError`; relancer le backfill réinitialise ces
photos et les remet en file. Pour examiner les événements non publiés, consulter
`PhotoProcessingOutbox` dans Prisma Studio ou PostgreSQL.

Paramètres principaux : `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`,
`REDIS_DB`, `REDIS_TLS`, `PHOTO_QUEUE_NAME`, `PHOTO_JOB_ATTEMPTS`,
`PHOTO_JOB_BACKOFF_MS` et `PHOTO_WORKER_CONCURRENCY`. Les identifiants de Redis
ne sont pas enregistrés dans le dépôt. Utiliser une configuration distincte
par environnement.

### Validation

Les tests ciblés du service d'images, du stockage et des métriques :

```bash
pnpm --filter server test
pnpm --filter worker test
pnpm --filter server check-types
pnpm --filter worker check-types
pnpm --filter web check-types
pnpm --filter server build
pnpm --filter web build
```
