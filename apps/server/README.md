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

## Traitement des images

Le traitement est synchrone dans la route d'upload et est également exposé sous
forme de services réutilisables dans `src/image-processing.ts`. L'original est
enregistré avant le traitement et n'est jamais transformé ni supprimé. Une
erreur de traitement conserve l'original et met le statut à `FAILED`; les
dérivés incomplets sont régénérés lors de la prochaine exécution.

Sharp valide le contenu décodé (JPEG, PNG, WebP ou GIF), sans faire confiance au
MIME ou à l'extension fournis par le client. Les uploads restent plafonnés à
20 MiB par Fastify, les images à 40 millions de pixels, Sharp à un thread
interne et le service accepte au plus un traitement simultané par processus.
Si le service est occupé, le nouvel upload est rejeté explicitement avec un
statut HTTP 503 avant le stockage et peut être renvoyé.

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

### Traiter les photos préexistantes

Après application de la migration, reconstruire le serveur puis lancer le
backfill séquentiel. Il ignore les photos terminées par la version courante
dont les trois dérivés sont présents. Il peut être relancé sans créer de
nouveaux chemins et vérifie la version de traitement ainsi que la présence de
chaque dérivé afin de réparer les fichiers manquants ou issus d'une version
antérieure :

```bash
pnpm --filter @clichy/db db:migrate
pnpm --filter server build
pnpm --filter server backfill:photos
```

Le processus a besoin du même `DATABASE_URL` et `PHOTO_STORAGE_PATH` que le
serveur. En production, la migration versionnée s'applique avec le mécanisme
d'exploitation habituel, puis le script compilé peut être exécuté dans le
conteneur serveur :

```bash
node dist/scripts/backfill-photos.mjs
```

Le script affiche les succès et les erreurs et retourne un code de sortie non
nul si certaines photos échouent. Il ne crée ni worker ni file d'attente.

### Validation

Les tests ciblés du service d'images, du stockage et des métriques :

```bash
pnpm --filter server test
pnpm --filter server check-types
pnpm --filter web check-types
pnpm --filter server build
pnpm --filter web build
```
