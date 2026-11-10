# Installer et exploiter Clichy sur Ubuntu Server

Ce guide décrit le déploiement privé utilisé pour Clichy : un hôte Ubuntu
Server 24.04 LTS nommé `valtask`, K3s mono-nœud, Traefik fourni par K3s, Helm,
Tailscale, un runner GitHub Actions auto-hébergé et GHCR. Les informations
propres à `valtask` (notamment le LV de 30 GB monté sur `/srv/clichy`).

## État fonctionnel et limites

| Composant | État dans le dépôt |
| --- | --- |
| Clichy Test et PostgreSQL dans `clichy-test` | Déployés par le workflow sur un push `master` |
| Ingress Clichy | Hôte `valtask`, entrypoint Traefik `web` (port 80) |
| Grafana | Ingress privé Tailscale, port 3000, entrypoint `grafana` |
| Headlamp | Ingress privé Tailscale dans `headlamp`, port 4466, entrypoint `headlamp` |
| Prometheus | Service interne au cluster ; pas d'Ingress |
| K3s API et PostgreSQL | Non publiés par Ingress |
| `dev` | Overlay disponible, pas de déploiement automatisé |
| `prod` | Overlay d'exemple seulement ; domaine et TLS fictifs, ne pas déployer |
| Cloudflare Tunnel | Projeté, non configuré |

Les URL de service sont réservées aux clients connectés au tailnet :

| Service | URL |
| --- | --- |
| Clichy Test | `http://valtask` |
| Grafana | `http://valtask:3000` |
| Headlamp | `http://valtask:4466` |

Ce sont des URL HTTP internes au tailnet, pas des adresses Internet publiques.
Le header de Clichy comporte actuellement des liens temporaires vers Grafana
et Headlamp.

## Installation sur un Ubuntu Server neuf

Les commandes de cette section sont exécutées sur le serveur, sauf indication
contraire. Utiliser un compte administrateur normal avec `sudo`, pas une
session root permanente.

### 1. Mettre à jour Ubuntu et installer les prérequis minimaux

Sur une installation fraîche, installer Git et curl avant de cloner le dépôt :

```bash
sudo apt update
sudo apt full-upgrade
sudo apt install -y ca-certificates curl git sudo
```

Si une mise à jour du noyau le demande, redémarrer puis reconnecter la session.
Vérifier l'accès administrateur SSH/console avant toute opération ultérieure
sur UFW.

Le script du dépôt complète les utilitaires sans mettre le système à niveau :

```bash
git clone https://github.com/Valatras/clichy.git
cd clichy
./infra/kubernetes/scripts/bootstrap-ubuntu.sh
```

Il installe uniquement les paquets manquants (`ca-certificates`, `curl`,
`git`, `gnupg`, `jq`, `openssl`, `python3`, `tar`, `ufw`) après confirmation.
Il n'installe pas Docker, n'active pas UFW et ne modifie pas SSH.

### 2. Définir et vérifier le nom d'hôte

Le déploiement Test attend le nom `valtask` :

```bash
hostnamectl status
```

Si le nom est différent et que ce serveur doit reprendre cette configuration,
changer explicitement le hostname :

```bash
sudo hostnamectl set-hostname valtask
```

Cette opération change l'identité système de l'hôte ; vérifier les éventuelles
dépendances locales avant de l'exécuter.

### 3. Installer Tailscale et vérifier MagicDNS

Utiliser la méthode officielle Tailscale pour Ubuntu :

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Ouvrir l'URL de connexion affichée et authentifier l'hôte dans le tailnet.
Activer MagicDNS dans la console d'administration Tailscale, puis vérifier
sur le serveur :

```bash
tailscale status
tailscale ip -4
getent hosts valtask
tailscale ping valtask
```

Depuis une autre machine connectée au même tailnet, vérifier aussi
`getent hosts valtask` et `tailscale ping valtask`. Le nom doit résoudre vers
l'adresse Tailscale du serveur. N'inscrire pas l'adresse IP fournie à titre
d'exemple dans le dépôt : une adresse Tailscale peut changer.

Référence : [installer Tailscale sur Linux](https://tailscale.com/kb/1031/install-linux/).

### 4. Vérifier UFW et limiter les ports aux clients Tailscale

K3s ServiceLB publie les ports des Services Traefik sur les interfaces du
nœud. Les ports ne sont donc pas automatiquement liés à `tailscale0`. Vérifier
l'état et les règles existantes avant d'ajouter quoi que ce soit :

```bash
sudo ufw status verbose
sudo ufw status numbered
ip -brief address show tailscale0
```

Si UFW est déjà actif, ajouter seulement les règles entrantes sur l'interface
Tailscale :

```bash
sudo ufw allow in on tailscale0 to any port 80 proto tcp comment 'Clichy via Tailscale'
sudo ufw allow in on tailscale0 to any port 3000 proto tcp comment 'Grafana via Tailscale'
sudo ufw allow in on tailscale0 to any port 4466 proto tcp comment 'Headlamp via Tailscale'
sudo ufw status numbered
```

Ne pas activer UFW automatiquement et ne pas modifier la configuration SSH
avec ce guide. Si UFW est inactif, examiner d'abord la méthode de connexion
administrative, ajouter au besoin une règle SSH adaptée à ce réseau, puis
activer le pare-feu depuis une session console ou vérifiée. Ces trois règles
ne retirent pas une règle existante plus large : examiner et supprimer
manuellement toute autorisation globale pour les mêmes ports seulement après
avoir identifié ses effets.

Ne pas ouvrir `6443` (Kubernetes), `5432` (PostgreSQL), `9090` (Prometheus) ou
`9093` (Alertmanager) dans UFW. Ne créer aucune redirection de ports sur le
routeur.

### 5. Installer K3s

Le script installe la version K3s `v1.37.2+k3s1` par défaut, version signalée
sur `valtask`. Elle peut être remplacée explicitement via `K3S_VERSION`.
L'installation amène le runtime `containerd`, Traefik, ServiceLB, Metrics
Server et le StorageClass `local-path` par défaut.

```bash
./infra/kubernetes/scripts/install-k3s.sh
```

Le script demande confirmation, n'écrase pas un kubeconfig existant et ne
réinstalle pas K3s si le service est déjà actif. Si le service existe mais
n'est pas actif, il s'arrête pour laisser diagnostiquer l'installation.
L'installation par défaut ne modifie pas les règles UFW ni SSH.

Le kubeconfig utilisateur est écrit dans
`$HOME/.kube/config-k3s` avec le mode `0600`. Le script n'altère pas les
permissions d'un répertoire `.kube` déjà présent. Pour cette session :

```bash
export KUBECONFIG="$HOME/.kube/config-k3s"
kubectl config current-context
kubectl get nodes -o wide
kubectl get storageclass
kubectl get pods -n kube-system -o wide
```

Pour rendre ce choix permanent, ajouter cette ligne une seule fois dans le
fichier de démarrage de son shell :

```bash
export KUBECONFIG="$HOME/.kube/config-k3s"
```

Ne jamais committer ou partager ce kubeconfig : il dispose des droits
administrateur du cluster. Le kubeconfig créé par le script utilise l'API
locale `127.0.0.1`; il est prévu pour le serveur et son runner, pas pour un
poste distant.

### 6. Installer Helm et configurer Traefik pour le tailnet

Sur le serveur, le script Helm ajoute le dépôt APT officiel en vérifiant les
fichiers existants. Il refuse de remplacer une configuration différente :

```bash
./infra/kubernetes/scripts/install-helm.sh
helm version --short
```

Configurer les deux entrypoints additionnels de Traefik K3s :

```bash
./infra/kubernetes/scripts/configure-lan-access.sh
```

Le script affiche le contexte, demande confirmation et applique le
`HelmChartConfig` versionné dans
[`traefik-lan/helmchartconfig.yaml`](./traefik-lan/helmchartconfig.yaml). La
configuration expose les entrypoints décrits ci-dessous. Si un
`HelmChartConfig` différent existe déjà, le script s'arrête sans l'écraser ;
fusionner les valeurs manuellement avant de le relancer.

| Entrypoint | Port externe | Usage |
| --- | ---: | --- |
| `web` | 80 | Ingress Clichy |
| `grafana` | 3000 | Ingress Grafana |
| `headlamp` | 4466 | Ingress Headlamp |

L'Ingress Clichy déclare explicitement
`traefik.ingress.kubernetes.io/router.entrypoints: web`. Grafana et Headlamp
déclarent respectivement `grafana` et `headlamp`. L'Ingress de Headlamp se trouve
dans le namespace `headlamp`, comme son Service.

Le chart Traefik est géré par K3s ; ne pas le gérer une seconde fois avec un
`helm upgrade` manuel. Les personnalisations passent par le
`HelmChartConfig`. Contrôler le résultat :

```bash
kubectl get helmchart traefik -n kube-system -o wide
kubectl get helmchartconfig traefik -n kube-system -o yaml
kubectl get deployment traefik -n kube-system
kubectl get service traefik -n kube-system -o wide
kubectl get service traefik -n kube-system \
  -o jsonpath='{range .spec.ports[*]}{.name}{" "}{.port}{"\n"}{end}'
kubectl get deployment traefik -n kube-system \
  -o jsonpath='{range .spec.template.spec.containers[0].args[*]}{.}{"\n"}{end}'
```

La liste de ports doit contenir `web 80`, `grafana 3000` et `headlamp 4466`.
Les arguments du Deployment doivent inclure `--entryPoints.web.address`,
`--entryPoints.grafana.address` et `--entryPoints.headlamp.address`.

### 7. Installer les outils du dépôt

Depuis le clone sur le serveur, avec le contexte K3s sélectionné :

```bash
./infra/kubernetes/scripts/install-monitoring.sh
./infra/kubernetes/scripts/install-headlamp.sh
```

`install-monitoring.sh` installe `kube-prometheus-stack` chart `93.1.1` dans
`monitoring`, applique le dashboard, le `ServiceMonitor`, les alertes et
l'Ingress Grafana. Le chart installe aussi Prometheus, Grafana, Alertmanager,
kube-state-metrics et node-exporter. Une nouvelle installation génère un mot
de passe Grafana aléatoire sous
`$HOME/.config/clichy/grafana-admin-password` (mode `0600`) et le place dans le
Secret `clichy-grafana-admin`. Le script n'affiche pas ce mot de passe.
L'identifiant initial est `admin`.

Si la release monitoring existe déjà, le script s'arrête. Avant une mise à
niveau, inspecter `helm get values prometheus-stack -n monitoring --all` et
`helm history prometheus-stack -n monitoring`. Confirmer la mise à niveau avec
`ALLOW_PROMETHEUS_UPGRADE=true`. Si l'ancien déploiement n'a pas le Secret
`clichy-grafana-admin`, le passage aux identifiants versionnés exige aussi
`ALLOW_GRAFANA_CREDENTIAL_UPDATE=true` ; cette action peut changer le mot de
passe Grafana.

`install-headlamp.sh` installe Headlamp chart `0.46.0`, crée au besoin les
namespaces `clichy-dev` et `clichy-test`, puis applique son RBAC et son Ingress.
Si la release existe déjà, inspecter `helm get values headlamp -n headlamp
--all` et `helm history headlamp -n headlamp`, puis confirmer explicitement le
remplacement par les valeurs versionnées avec `ALLOW_HEADLAMP_UPGRADE=true`.
Headlamp a des droits d'administration dans ces deux namespaces, notamment
sur les Secrets. Il a seulement des droits de lecture sur certains objets à
l'échelle du cluster. Garder Headlamp sur le tailnet et limiter les ACL
Tailscale aux administrateurs de confiance.

Vérifier les Ingress et ressources :

```bash
kubectl get ingress -A -o wide
kubectl get pods,services -n monitoring -o wide
kubectl get pods,services -n headlamp -o wide
kubectl get servicemonitors,prometheusrules -n monitoring
```

Grafana n'est pas le serveur Prometheus : Prometheus collecte les séries,
Grafana affiche le dashboard **Clichy Photo Service**, Alertmanager relaie les
alertes et Metrics Server fournit les métriques instantanées à `kubectl top`
et aux HPA.

### 8. Préparer l'environnement et les secrets Test

Le déploiement automatique utilise le namespace `clichy-test`. Depuis un
terminal ayant le kubeconfig K3s :

```bash
./infra/kubernetes/scripts/prepare-namespace.sh test
```

Le script demande confirmation, crée le Secret `clichy-server-secrets`, le
Secret `ghcr-pull-secret` et le StatefulSet PostgreSQL, puis attend la base.
Il crée son fichier local dans `$HOME/.config/clichy/test-secrets.env` avec des
permissions restrictives. Fournir un jeton GitHub ayant `read:packages` pour
les images GHCR du dépôt. Le jeton est lu sans écho ; ne pas l'ajouter au dépôt
ou aux logs.

Les identifiants et mots de passe ne sont pas fournis dans la documentation.
Le script génère `BETTER_AUTH_SECRET` et encode le mot de passe PostgreSQL dans
`DATABASE_URL`. Les credentials Kubernetes doivent rester propres à chaque
namespace et hors Git.

### 9. Installer le runner GitHub Actions auto-hébergé

Le workflow utilise deux types de runner :

- `ci` et `package` s'exécutent sur `ubuntu-latest` hébergé par GitHub. Docker
  Buildx y construit les images et le `GITHUB_TOKEN` avec la permission
  `packages: write` les publie dans GHCR.
- `deploy` s'exécute uniquement sur push vers `master`, avec les labels
  `self-hosted` et `linux`. Il utilise Node.js 24, pnpm, `kubectl` et le
  kubeconfig pour appliquer les migrations à Test puis déployer les deux
  images.

Docker n'est pas requis sur le serveur : K3s utilise `containerd`, et le job de
déploiement ne construit pas d'image.

Dans **Settings → Actions → Runners → New self-hosted runner** du dépôt,
choisir Linux x64 et suivre les commandes affichées pour télécharger et
décompresser le runner dans un répertoire dédié. Pour créer le compte et le
répertoire lors d'une première installation :

```bash
sudo adduser --disabled-password --gecos "" clichy-runner
sudo install -d -o clichy-runner -g clichy-runner -m 0750 /opt/actions-runner
```

Exécuter les commandes de téléchargement puis `config.sh` fournies par GitHub
dans `/opt/actions-runner` sous ce compte. La configuration doit inclure les
labels `self-hosted` et `linux`, utilisés par le workflow. Le jeton de
configuration est temporaire : ne pas le documenter ni le réutiliser. Depuis
le répertoire du runner, installer les dépendances Linux requises et le
service :

```bash
cd /opt/actions-runner
sudo ./bin/installdependencies.sh
sudo ./svc.sh install clichy-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

Le runner doit disposer de `kubectl` et d'un kubeconfig accessible par son
compte. Le job est configuré pour utiliser le kubeconfig par défaut
`$HOME/.kube/config` du service. Si le répertoire du runner est possédé par
`clichy-runner`, préparer le kubeconfig avant le premier démarrage du service
et ne pas écraser un fichier ni modifier silencieusement les permissions d'un
répertoire existant :

```bash
if ! sudo test -d /home/clichy-runner/.kube; then
  sudo install -d -o clichy-runner -g clichy-runner -m 0700 /home/clichy-runner/.kube
else
  echo "Vérifier propriétaire et permissions de /home/clichy-runner/.kube avant de continuer."
fi
if ! sudo test -e /home/clichy-runner/.kube/config; then
  sudo install -o clichy-runner -g clichy-runner -m 0600 \
    /etc/rancher/k3s/k3s.yaml /home/clichy-runner/.kube/config
else
  echo "Le kubeconfig du runner existe déjà : vérifiez-le sans l'écraser."
fi
```

Adapter le nom du compte et son chemin si nécessaire. Ce kubeconfig K3s
possède les droits administrateur du cluster : quiconque peut pousser du code
sur la branche de déploiement peut déclencher des opérations privilégiées.
Protéger `master`, limiter les personnes autorisées à y pousser, ne pas lancer
de code de pull request non fiable sur ce runner et ne pas exécuter le service
runner comme root. Les pull requests du workflow sont traitées par les runners
hébergés.

Aucun secret GitHub supplémentaire n'est référencé par le workflow actuel.
`GITHUB_TOKEN` est fourni automatiquement pour GHCR ; le jeton GHCR de lecture
est conservé dans `ghcr-pull-secret` Kubernetes. Sur le serveur, vérifier que
le runner apparaît **Idle/Online** dans GitHub et que son compte peut exécuter :

```bash
kubectl config current-context
kubectl get nodes
kubectl get secret clichy-server-secrets -n clichy-test
kubectl get service clichy-postgres -n clichy-test
```

### 10. Première publication et déploiement

Le dépôt contient une migration Prisma initiale. À chaque push vers `master`,
le workflow exécute les vérifications/tests/build, publie les images
`sha-<commit>` à GHCR, applique `prisma migrate deploy` sur Test via un
port-forward local, applique les manifests, met à jour les images et attend
les rollouts du serveur et du web.

Une fois le runner en ligne, pousser une révision validée sur `master`, puis
consulter **Actions → Clichy CI/CD**. Sur le serveur :

```bash
kubectl get deployments,pods,pvc,ingress -n clichy-test -o wide
kubectl get hpa -n clichy-test
kubectl rollout status deployment/clichy-server -n clichy-test
kubectl rollout status deployment/clichy-web -n clichy-test
curl -fsS -I http://valtask/
```

Les `dev` et `prod` ne sont pas déployés par ce workflow. Le script manuel
`deploy.sh` accepte uniquement `dev` ou `test` et ne réalise pas les
migrations ; pour Test, laisser le workflow gérer les migrations.

## Traefik, Ingress et vérification des URL

Les Ingress se trouvent dans ces namespaces :

```bash
kubectl get ingress -n clichy-test -o yaml
kubectl get ingress -n monitoring -o yaml
kubectl get ingress -n headlamp -o yaml
```

Le résultat attendu est Clichy `clichy-web` dans `clichy-test` sur `web`,
Grafana dans `monitoring` sur `grafana`, et Headlamp `headlamp-lan` dans
`headlamp` sur `headlamp`. Headlamp et son Service partagent le namespace
`headlamp`.

Depuis le serveur ou un client connecté au tailnet :

```bash
getent hosts valtask
tailscale ping valtask
curl -fsS -I http://valtask/
curl -fsS http://valtask:3000/api/health
curl -fsS -I http://valtask:4466/
```

Le endpoint de santé Grafana permet de vérifier son démarrage. Headlamp peut
rediriger vers sa page d'authentification. Un HTTP réussi ne signifie pas que
l'utilisateur est authentifié dans Headlamp/Grafana.

Contrôler aussi les règles UFW et leur interface :

```bash
sudo ufw status verbose
sudo ufw status numbered
ip -brief address show tailscale0
```

Les Services `clichy-postgres`, Prometheus, l'API Kubernetes et Alertmanager
restent ClusterIP/locaux au cluster. Ne créez pas d'Ingress public pour eux.
Le port Grafana 3000 et Headlamp 4466 ne doivent être joignables que sur
Tailscale, jamais depuis le réseau Internet.

## Stockage, persistance et sauvegardes

Les manifests actuels utilisent les éléments suivants :

- PostgreSQL est un StatefulSet `clichy-postgres`, une réplique, avec le PVC
  `data-clichy-postgres-0`, `ReadWriteOnce`, demande de `10Gi`. Le PVC
  provient du `volumeClaimTemplates` du StatefulSet.
- Les fichiers photo sont montés dans le serveur à `/data/photos` depuis le
  PVC `clichy-server-photos`, `ReadWriteOnce`, demande de `10Gi`.
- Aucun des deux PVC ne précise `storageClassName`. K3s fournit par défaut le
  StorageClass `local-path`, utilisé pour les volumes locaux du nœud. Ce sont
  des PVC Kubernetes dynamiquement provisionnés, pas des montages explicites
  du dossier `/srv/clichy`.
- Les valeurs Helm demandent également `10Gi` pour Prometheus et `2Gi` pour
  Grafana avec `local-path`.

L'hôte `valtask` est rapporté comme ayant un volume LVM dédié de 30 GB monté
sur `/srv/clichy`. Aucun manifest, `StorageClass` ou script du dépôt ne relie
actuellement le provisioner `local-path` à ce chemin. Ne supposez donc pas que
les données Kubernetes sont sur ce LV. Vérifier sur l'hôte et le cluster :

```bash
findmnt /srv/clichy
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
df -h /srv/clichy /var/lib/rancher/k3s/storage
kubectl get storageclass
kubectl get pvc -A -o wide
kubectl get pv -o wide
kubectl get configmap local-path-config -n kube-system -o yaml
```

Inspecter le chemin local associé à chaque PV avec `kubectl describe pv <nom>`
ou son champ `.spec.local.path`. Vérifier la configuration réelle du
provisioner ; son répertoire de base peut différer si K3s a été personnalisé.

Les demandes de capacité sont des demandes Kubernetes et ne constituent pas
forcément des quotas de fichiers sur le disque local. Pour Test et le
monitoring, les demandes totalisent déjà environ `32Gi` (PostgreSQL 10, photos
10, Prometheus 10, Grafana 2), sans compter l'OS. Le LV communiqué de 30 GB ne
peut donc pas simplement héberger ces volumes sans revoir les tailles, libérer
de l'espace ou agrandir le stockage. L'ajout d'un namespace Dev rajoute ses
propres volumes DB/photos.

Avant d'intégrer `/srv/clichy`, décider du chemin de stockage K3s, de la
capacité et d'une procédure de migration des PV déjà provisionnés. Changer le
chemin du provisioner ne déplace pas les données existantes. Cette
configuration et cette migration restent à faire ; le dépôt n'utilise pas NFS
pour le déploiement courant.

Sauvegarder au minimum PostgreSQL et les fichiers photo, de préférence vers
un support distinct du serveur, puis tester une restauration. Les PVC locaux
ne sont pas des sauvegardes et un seul nœud n'offre ni réplication ni haute
disponibilité. Les métriques historiques Prometheus peuvent être considérées
séparément ; le dashboard et les règles Clichy sont versionnés dans Git.
Aucune sauvegarde/restauration applicative automatique n'est fournie.

## Monitoring et administration

Prometheus scrape les métriques cluster et le Server Clichy via le
`ServiceMonitor` `clichy-server` (namespaces Dev/Test, chemin interne
`/metrics`). Le ConfigMap dashboard est découvert par le sidecar Grafana ; les
alertes Clichy sont des `PrometheusRule`. L'Ingress Grafana utilise le port
3000 sur Tailscale.

Le premier mot de passe Grafana est local :

```bash
cat "$HOME/.config/clichy/grafana-admin-password"
```

Ne pas partager cette valeur. Les tokens Headlamp sont des credentials
administratifs ; pour une session locale, ils peuvent être créés avec
`kubectl create token headlamp -n headlamp --duration=1h`. L'accès Tailscale à
Headlamp doit rester réservé aux administrateurs.

Commandes de vérification :

```bash
kubectl get pods,services -n monitoring -o wide
kubectl get servicemonitors,prometheusrules -n monitoring
kubectl get ingress -n monitoring
kubectl get pods,services -n headlamp -o wide
kubectl get ingress -n headlamp
kubectl get hpa -n clichy-test
kubectl top nodes
kubectl top pods -n clichy-test
```

Voir le [guide Headlamp, monitoring et diagnostic](./administrator_headlamp_guide.md)
pour les permissions RBAC et les commandes de dépannage des Pods.

## Diagnostic courant

Lister les événements et décrire un Pod qui ne démarre pas :

```bash
kubectl get pods -n clichy-test -o wide
kubectl get events -n clichy-test --sort-by=.metadata.creationTimestamp
kubectl describe pod -n clichy-test <nom-du-pod>
kubectl logs -n clichy-test deployment/clichy-server --all-containers --tail=100
kubectl logs -n clichy-test deployment/clichy-web --all-containers --tail=100
kubectl logs -n clichy-test statefulset/clichy-postgres --all-containers --tail=100
```

Pour un crash précédent : `kubectl logs -n clichy-test <pod> --previous`.
Vérifier les erreurs `ImagePullBackOff` par le Secret GHCR, le statut des PVC,
les sondes du conteneur, les secrets applicatifs et les événements. Ne pas
supprimer de PVC/PV pour résoudre un problème de démarrage.

Pour vérifier le runner :

```bash
sudo ./svc.sh status
sudo journalctl -u 'actions.runner*' --since '30 minutes ago' --no-pager
```

Le nom systemd exact est indiqué par `./svc.sh status`. Vérifier également
l'état Online/Idle du runner dans les paramètres GitHub du dépôt.

## Cloudflare Tunnel — prévu, pas configuré

Le dépôt ne crée pas de tunnel Cloudflare, d'enregistrement DNS, de nom de
domaine ou de certificats TLS. Avant une exposition publique éventuelle, il
faudra choisir le hostname, configurer le TLS et mettre à jour ensemble
`BETTER_AUTH_URL`, `CORS_ORIGIN`, l'hôte de l'Ingress et le routage du tunnel.

Si cette étape est réalisée, n'exposer que l'application après revue de son
authentification. Grafana, Headlamp, l'API Kubernetes, PostgreSQL, Prometheus
et Alertmanager doivent rester privés au cluster/tailnet.
