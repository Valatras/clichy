# Démo devant le professeur

Routine de 15 à 20 minutes, basée sur les manifests de ce dépôt. Répéter les
commandes sur `valtask` avant la présentation : le serveur peut avoir une autre
version du projet. Les commandes ci-dessous n'ont pas été exécutées sur le cluster.

## Avant de commencer

Ouvrir quatre onglets : l'application Test (`http://clichy-test.home.arpa`),
GitHub Actions, Grafana (`http://valtask:3000`) et Headlamp
(`http://valtask:4466`). Vérifier la résolution des noms depuis le PC de présentation
et se connecter à l'avance. Préparer un compte Test et quelques photos, dont deux
copies de la même image pour montrer les doublons et la comparaison.

Sur `valtask`, depuis le checkout utilisé pour la démo :

```bash
cd /opt/clichy
git log -1 --oneline
kubectl config current-context
kubectl get nodes
kubectl get namespaces
kubectl get deployments -n clichy-test
kubectl get deployments -n clichy-prod
kubectl top nodes
```

Préparer aussi **avant la séance** un petit changement visible et une nouvelle
migration compatible avec les anciens Pods (par exemple un champ facultatif
réellement utile). Générer et tester la migration en développement selon le
[guide des migrations](deployment.md), relire le SQL, puis préparer
le commit à pousser pendant la démo. Une migration déjà appliquée ne démontre
pas l'application d'une nouvelle migration.

## 1. Application, Ingress et stockage — 2 min

Dans le navigateur : se connecter, ouvrir la photothèque, montrer les doublons
et l'outil de comparaison. Importer ensuite quelques photos en Test.

```bash
kubectl get ingress -A
kubectl get services -n clichy-test
kubectl get pvc -n clichy-test
```

À expliquer : « Traefik est le contrôleur Ingress commun. Il route le Web et
l'API vers leurs Services. Les données et les photos utilisent des volumes
persistants ; les namespaces séparent les environnements. » Les Ingress Grafana
et Headlamp utilisent aussi Traefik, sur des ports LAN dédiés.

## 2. Workers et scaling depuis Headlamp — 3 min

Dans **Headlamp**, sélectionner `clichy-test`, ouvrir la liste des Deployments
puis `clichy-worker`. Relever le nombre initial de réplicas, utiliser l'action
de scaling pour passer de **1 à 2**, puis montrer les deux Pods Ready.
Selon la version de Headlamp, l'action se trouve dans le menu du Deployment ;
à défaut, éditer uniquement `spec.replicas` dans son YAML. Cela nécessite un
compte autorisé à modifier le Deployment.

Vérification dans le terminal :

```bash
kubectl rollout status deployment/clichy-worker -n clichy-test --timeout=180s
kubectl get pods -n clichy-test -l app=clichy-worker -o wide
kubectl logs -n clichy-test -l app=clichy-worker --all-containers=true --prefix --tail=20
```

Importer plusieurs photos pendant que les deux workers sont actifs. Dans Grafana,
montrer **Photo Queue Jobs by State**, **Photo Worker Job Rate** et
**Photo Outbox Backlog**. Les travaux sont parfois trop rapides pour voir une
file en attente ; des compteurs de travaux terminés qui augmentent constituent
un meilleur aperçu. Les logs permettent d'identifier les Pods qui prennent les
travaux, sans garantir que chacun en recevra pendant un petit import.

À expliquer : « L'API enregistre une photo et un événement outbox ; Redis/BullMQ
distribue les travaux aux workers qui calculent les dérivés et les métadonnées. »
Ces workers applicatifs sont distincts des nœuds Kubernetes et des nœuds Citus.

Revenir à **1 réplica** dans Headlamp après la démonstration. Équivalent terminal
si l'interface n'est pas disponible :

```bash
kubectl scale deployment/clichy-worker -n clichy-test --replicas=2
kubectl rollout status deployment/clichy-worker -n clichy-test --timeout=180s
# Après la démonstration :
kubectl scale deployment/clichy-worker -n clichy-test --replicas=1
kubectl rollout status deployment/clichy-worker -n clichy-test --timeout=180s
```

Le worker n'a pas de HPA. Utiliser ce Deployment pour le scaling manuel : les
HPAs de `clichy-server` et `clichy-web` pourraient annuler un changement manuel.
Un prochain déploiement remet aussi les compteurs prévus par les manifests.

## 3. Sharding Citus en Test — 2 min

Une seule commande pour afficher les tables, la clé et le nombre de shards :

```bash
kubectl exec -i -n clichy-test deployment/clichy-citus -- \
  psql -X -U clichy -d clichy_test -v ON_ERROR_STOP=1 <<'SQL'
SELECT p.logicalrelid::regclass AS table_name,
       p.partmethod AS method,
       CASE WHEN p.partmethod = 'h'
            THEN column_to_column_name(p.logicalrelid, p.partkey)
       END AS distribution_key,
       p.colocationid,
       count(s.shardid) AS shards
FROM pg_dist_partition p
LEFT JOIN pg_dist_shard s USING (logicalrelid)
WHERE p.logicalrelid IN ('"user"'::regclass, '"Photo"'::regclass,
                         '"PhotoProcessingOutbox"'::regclass)
GROUP BY p.logicalrelid, p.partmethod, p.partkey, p.colocationid
ORDER BY 1;
SQL
```

Résultat attendu : `Photo` et `PhotoProcessingOutbox` ont la méthode **h**,
la clé **userId**, **32 shards chacune**, et le même identifiant de colocation.
`user` est une table de référence (`n`, un shard).

À expliquer : « Les métadonnées des photos sont réparties par utilisateur.
Photo et outbox sont colocalisées pour garder les données associées ensemble. »
Les fichiers images restent sur le PVC. Tous les shards sont sur **un seul Pod
Citus** : ceci montre le sharding logique, pas une distribution entre serveurs.
Le CNPG de Test ne réplique pas cette base Citus.

Si le Deployment Citus est absent ou les résultats diffèrent, vérifier la version
déployée et le [guide sharding](../infrastructure/databases.md#citus-logical-sharding) avant la séance.

## 4. Réplication PostgreSQL en Production — 2 min

```bash
kubectl get pods -n clichy-prod -l cnpg.io/cluster=clichy-postgres \
  -L cnpg.io/instanceRole
PRIMARY=$(kubectl get cluster.postgresql.cnpg.io clichy-postgres -n clichy-prod \
  -o jsonpath='{.status.currentPrimary}')
kubectl exec -n clichy-prod "$PRIMARY" -- psql -X -U postgres -d postgres -c \
  'SELECT application_name, state, sync_state, sent_lsn, replay_lsn FROM pg_stat_replication;'
```

Attendu : deux Pods, un primaire et un réplica ; une ligne **streaming / async**
dans la requête. Deux Pods Running seuls ne prouvent pas que les données se
répliquent. Ne pas continuer avec un nom de primaire vide ou une requête en erreur.

Dans Grafana, sélectionner `clichy-prod`, montrer **PostgreSQL Recovery State
(0 primary, 1 standby)**, **PostgreSQL Streaming Replicas** et
**PostgreSQL Replica Lag (seconds)**.

À expliquer : « Le primaire envoie son WAL au standby en réplication asynchrone.
L'application utilise le Service read-write. » Les deux instances restent sur
`valtask` : elles ne protègent pas contre la panne du serveur physique.
Cette séquence observe la réplication sans supprimer de Pod ni provoquer de failover.

## 5. Grafana et autoscaling — 2 min

Dashboard **Clichy Photo Service**, filtre `clichy-test`, période **Last 15 minutes**,
rafraîchissement 5 ou 10 secondes. Montrer :

- **Deployment Desired vs Available Replicas** : conséquence du scaling Headlamp.
- **CPU Usage by Pod**, **Memory Usage by Pod** : charge des services.
- **HTTP Request Rate**, **HTTP Request Duration (p95)** : activité de l'API.
- **HPA Current vs Desired Replicas** : scaling automatique API/Web.

Prévoir 15 à 30 secondes de collecte, voire plusieurs minutes pour les courbes
de taux. Un panneau vide ne signifie pas zéro : vérifier les scrapes selon le
[guide monitoring](../infrastructure/monitoring.md).

Option, si le temps le permet, pour provoquer une charge Test :

```bash
kubectl get hpa -n clichy-test
./infra/kubernetes/scripts/load-test-test.sh server 180 32
```

Le générateur demande confirmation et s'arrête après trois minutes. Dans un autre
terminal : `kubectl get hpa -n clichy-test -w` (Ctrl+C pour quitter l'observation).
Le HPA cible 70 % de la CPU demandée, entre 1 et 4 Pods. La charge ne garantit
pas un scaling si le seuil n'est pas atteint. Les requêtes non authentifiées
retournent 401 : elles servent à générer du trafic, pas à valider un parcours métier.

## 6. Push → CI → Test → validation → Production — 5 à 8 min

1. Pousser sur `master` le commit préparé avec le changement visible et la migration.
2. Dans GitHub Actions, ouvrir **ci-cd.yml** : montrer les tests, les images taguées
   `sha-<commit>`, puis le job **Deploy to Test on valtask**.
3. Dans les logs de déploiement Test, montrer la nouvelle migration appliquée
   **avant** les rollouts. Vérifier le changement dans le navigateur Test.
4. Sur le même commit de `master` (ne pas pousser entre-temps), lancer **Run workflow**
   avec `deploy_prod=true`. Ce nouveau run refait CI, images et Test avant Production.
   Approuver l'environnement `production` si une protection GitHub est configurée.
5. Montrer la migration et le rollout Production dans les logs, puis le changement
   sur `https://valtask.xyz`.

Pour afficher l'historique des migrations Test en lecture seule :

```bash
kubectl exec -n clichy-test deployment/clichy-citus -- \
  psql -X -U clichy -d clichy_test -c \
  'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5;'
```

### Mesurer la disponibilité pendant le rollout

Avant de lancer le workflow Production, démarrer dans un deuxième terminal :

```bash
python3 - <<'PY'
import datetime
import time
import urllib.error
import urllib.request

# Route API via l'Ingress LAN ; évite de mesurer uniquement le cache du Web.
url = 'http://127.0.0.1/photos'
try:
    while True:
        request = urllib.request.Request(url, headers={'Host': 'valtask.xyz'})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        except Exception as error:
            status = type(error).__name__
        print(datetime.datetime.now().isoformat(timespec='seconds'), status, flush=True)
        time.sleep(1)
except KeyboardInterrupt:
    pass
PY
```

Sur `valtask`, vérifier **avant** le rollout que la sonde retourne régulièrement
**401** : c'est la réponse attendue de `/photos` sans authentification. Un 404
signalerait un mauvais routage. Si l'Ingress LAN n'est pas accessible sur loopback,
adapter l'adresse à celle de l'Ingress. Pendant le déploiement, surveiller les
timeouts, erreurs réseau et 5xx. Ctrl+C arrête la sonde.

Dans un troisième terminal, pendant le déploiement :

```bash
kubectl get pods -n clichy-prod -l app=clichy-server -w
```

Cette observation échantillonne une route toutes les secondes ; elle ne prouve
pas l'absence absolue d'interruption ni le bon fonctionnement des uploads pendant
une migration. Associer la sonde, les Pods Ready et une vérification navigateur.
La durée de construction des images peut dépasser le créneau : lancer la pipeline
au début de la présentation puis présenter les étapes 1 à 5 pendant l'attente.

## Points à annoncer honnêtement pour le barème

| Exigence | Ce que cette démo permet de montrer |
| --- | --- |
| Sharding | 32 shards logiques en Test, sur un seul Pod Citus |
| Réplication DB | CNPG primaire/standby en Production ; Citus Test distinct |
| Réplicas applicatifs | Deux workers simultanés via Headlamp ; HPA API/Web en Test |
| Cache répliqué | Non réalisé : Redis a une seule instance par namespace |
| Rafraîchissement Test depuis Prod | Procédure automatisée et validée non réalisée ; ne pas remplacer Citus par un dump improvisé |
| Zéro downtime | À mesurer pendant le rollout réel, avec une migration compatible |
| Documentation | Montrer ce site : onboarding, CI/CD, migrations, monitoring et guide de migration cloud |

La réplication Redis et le rafraîchissement de Test restent des écarts au sujet.
Le nombre de Pods et les courbes doivent être constatés en direct, pas présentés
comme acquis sur la seule base des manifests.
