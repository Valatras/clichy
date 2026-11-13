# Installer et exploiter Clichy sur Ubuntu Server

Ce guide décrit l'infrastructure Clichy : un hôte Ubuntu Server 24.04 LTS
nommé `valtask`, K3s mono-nœud, Traefik fourni par K3s, Helm, Tailscale, un
runner GitHub Actions auto-hébergé et GHCR. Test et l'administration sont
privés ; Prod passe par Cloudflare Tunnel. Les informations propres à
`valtask` (notamment le LV de 30 GB monté sur `/srv/clichy`).

## État fonctionnel et limites

| Environnement | Namespace et machine | Hostname / accès |
| --- | --- | --- |
| Dev | `clichy-dev`, cluster Kubernetes local uniquement | `http://clichy.localhost` |
| Test | `clichy-test`, serveur `valtask` | `http://clichy-test.home.arpa`, LAN/Tailscale uniquement |
| Prod | `clichy-prod`, serveur `valtask` | `https://valtask.xyz`, Internet via Cloudflare Tunnel |

| Composant | État dans le dépôt |
| --- | --- |
| Test et PostgreSQL | Déploiement automatique après succès CI sur `master` |
| Prod | Manifest prêt, aucun déploiement automatique activé |
| Grafana | Ingress privé Tailscale, port 3000, entrypoint `grafana` |
| Headlamp | Ingress privé Tailscale dans `headlamp`, port 4466, entrypoint `headlamp` |
| Prometheus | Service interne au cluster ; pas d'Ingress |
| K3s API, PostgreSQL, monitoring et administration | Privés, non publiés par l'Ingress public |
| Cloudflare Tunnel | Configuré hors dépôt pour router vers Traefik `web` |

Les namespaces sont des frontières d'isolation logique, pas des machines ou
des clusters différents. Test et Prod ont chacun leur StatefulSet PostgreSQL,
leurs Secrets et leurs PVC propres dans leur namespace.

Les URL privées de service sont réservées aux clients connectés au LAN ou au
tailnet :

| Service privé | URL |
| --- | --- |
| Clichy Test | `http://clichy-test.home.arpa` |
| Grafana | `http://valtask:3000` |
| Headlamp | `http://valtask:4466` |

Test et les outils d'administration ne sont accessibles que depuis le LAN ou
Tailscale. Le DNS privé doit résoudre `clichy-test.home.arpa` vers `valtask`.
Prod est accessible publiquement à `https://valtask.xyz`. Cloudflare termine
HTTPS en amont et le tunnel transmet HTTP à Traefik sur l'entrypoint `web`.
`www.valtask.xyz` ne sert pas une seconde application ; configurer sa
redirection vers `https://valtask.xyz` dans Cloudflare.

`clichy-test.home.arpa` est un nom privé et n'est pas résolu automatiquement
par les postes clients. Sur chaque machine cliente, ajoutez au fichier hosts
la correspondance suivante :

```text
192.168.129.10 clichy-test.home.arpa
```

Le fichier est `/etc/hosts` sous Linux/macOS et
`C:\Windows\System32\drivers\etc\hosts` sous Windows (ouvrez l'éditeur avec
les droits administrateur). `192.168.129.10` est l'adresse LAN d'exemple
actuelle de `valtask` ; remplacez-la si l'adresse LAN du serveur change.
Vérifiez l'accès depuis le poste client avec :

```bash
curl -I http://clichy-test.home.arpa
```

Ce hostname est réservé à l'accès privé au LAN/Tailscale. Ne l'ajoutez pas au
tunnel Cloudflare public.

## Déployer les environnements

### Dev — cluster local uniquement

Le workflow GitHub ne déploie jamais Dev. Avant toute commande Kubernetes,
vérifier le contexte actif et les nœuds : ne pas exécuter ces commandes avec
le contexte K3s de `valtask`.

```bash
kubectl config current-context
kubectl get nodes -o wide
```

Construire les images `clichy-server:dev` et `clichy-web:dev` localement, puis
les charger dans le runtime du cluster utilisé :

```bash
docker build -f infra/docker_clichy_server/Dockerfile -t clichy-server:dev .
docker build -f infra/docker_clichy_web/Dockerfile \
  --build-arg VITE_SERVER_URL=http://clichy.localhost \
  -t clichy-web:dev .
kind load docker-image clichy-server:dev clichy-web:dev
# ou, pour Minikube :
minikube image load clichy-server:dev clichy-web:dev
```

Une fois les images présentes dans le cluster local, créer les identifiants
de développement locaux et appliquer l'overlay :

```bash
kubectl apply -f infra/kubernetes/server_secrets.yaml
kubectl apply -k infra/kubernetes/overlays/dev
```

Les URL Better Auth/CORS sont `http://clichy.localhost`, l'API utilise
`NODE_ENV=development` et aucun Secret GHCR n'est requis. Le frontend reste une
image compilée en mode production. Le fichier `server_secrets.yaml` est réservé
au namespace Dev ; ne jamais le copier vers Test ou Prod. Accéder à l'Ingress
depuis le poste local après avoir configuré le cluster pour exposer Traefik
localement.

### Test — valtask, privé

La CI applique Test automatiquement après CI et publication des images sur un
push `master`; les images appliquées portent `sha-<GITHUB_SHA>`. Le hostname
est `clichy-test.home.arpa`, à résoudre uniquement par DNS LAN/Tailscale.
L'Ingress conserve `/api/auth`, `/photos` et le frontend `/`. `BETTER_AUTH_URL`
et `CORS_ORIGIN` sont tous deux `http://clichy-test.home.arpa`. Test n'utilise
pas de host public ni de règle Cloudflare. Préparer séparément ses Secrets
`clichy-server-secrets` et `ghcr-pull-secret` avec
`prepare-namespace.sh test`; ne pas les réutiliser en Prod.

Better Auth et Fastify approuvent cette origine exacte. Les attributs des
cookies suivent le schéma de `BETTER_AUTH_URL` : HTTP utilise `SameSite=Lax`
sans `Secure`, tandis que HTTPS utilise `SameSite=None; Secure`.

### Prod — valtask, approbation manuelle requise

`dev`, `test` et `prod` sont des environnements séparés :

- **Dev** (`clichy-dev`) est réservé au cluster local, aux images construites
  localement et à `clichy.localhost`.
- **Test** (`clichy-test`) est le déploiement privé sur `valtask`. Le workflow
  GitHub Actions le met à jour automatiquement après les vérifications, tests,
  builds et publication sur un push `master`.
- **Prod** (`clichy-prod`) est l'environnement public de `valtask.xyz`.
  Il possède sa propre base PostgreSQL, ses Secrets et ses PVC, et n'est pas
  déployé automatiquement par la CI.

Les namespaces isolent logiquement les ressources sur le même cluster mono-nœud ;
ils ne sont pas des clusters séparés. Le workflow `.github/workflows/ci.yml`
construit les images du serveur et du web avec Docker puis, pour un push sur
`master`, les publie dans GHCR sous les tags
`ghcr.io/valatras/clichy-server:sha-<GITHUB_SHA>` et
`ghcr.io/valatras/clichy-web:sha-<GITHUB_SHA>`. Les pull requests exécutent CI,
mais ne publient pas ces images.

Promouvez en Prod le SHA complet d'un commit dont le déploiement Test a réussi,
pas simplement la tête actuelle de `master`. Cette vérification garantit que
les images de ce commit sont disponibles dans GHCR et que la version exacte
a déjà passé le déploiement Test. Aucun job de déploiement Prod n'est activé
dans la CI ; la promotion est une commande manuelle approuvée.

#### Préparer les Secrets de Prod

Créez d'abord le namespace puis stockez les valeurs dans un fichier local
protégé, ou faites écrire ce fichier par votre gestionnaire de secrets. Ne
placez jamais ces valeurs dans Git, dans cette documentation ou dans les logs :

```bash
kubectl apply -f infra/kubernetes/overlays/prod/namespace.yaml
install -d -m 700 "$HOME/.config/clichy"
umask 077
${EDITOR:-vi} "$HOME/.config/clichy/prod-secrets.env"
chmod 600 "$HOME/.config/clichy/prod-secrets.env"
```

Le fichier doit contenir exactement les clés nécessaires (avec des valeurs
réelles fournies localement) : `BETTER_AUTH_SECRET`, `DATABASE_URL`,
`POSTGRES_DB`, `POSTGRES_USER` et `POSTGRES_PASSWORD`. Le `DATABASE_URL` doit
utiliser les mêmes identifiants que `POSTGRES_USER` et `POSTGRES_PASSWORD`,
viser `clichy-postgres:5432` et la base `POSTGRES_DB` dans `clichy-prod`. Encodez
les caractères spéciaux du mot de passe pour une URL PostgreSQL. Créez ou
mettez à jour le Secret sans afficher son contenu :

```bash
set -o pipefail
kubectl create secret generic clichy-prod-secrets \
  --namespace=clichy-prod \
  --from-env-file="$HOME/.config/clichy/prod-secrets.env" \
  --dry-run=client -o yaml |
  kubectl apply -f -
```

Créez également un jeton GitHub limité à `read:packages`. Le fichier Docker
local suivant est protégé et n'est pas commité ; `docker login` lit le jeton
sur stdin :

```bash
install -d -m 700 "$HOME/.config/clichy/docker"
read -r -p "GHCR username: " GHCR_USERNAME
read -r -s -p "GHCR token with read:packages: " GHCR_TOKEN
printf '\n'
printf '%s' "$GHCR_TOKEN" |
  docker --config "$HOME/.config/clichy/docker" login ghcr.io \
    --username "$GHCR_USERNAME" --password-stdin
unset GHCR_TOKEN
chmod 600 "$HOME/.config/clichy/docker/config.json"
kubectl create secret generic ghcr-pull-secret \
  --namespace=clichy-prod \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson="$HOME/.config/clichy/docker/config.json" \
  --dry-run=client -o yaml |
  kubectl apply -f -
```

Vérifiez les noms/types et les clés sans afficher aucune valeur :

```bash
kubectl describe secret clichy-prod-secrets -n clichy-prod
kubectl describe secret ghcr-pull-secret -n clichy-prod
```

`clichy-prod-secrets` doit montrer les cinq clés listées ci-dessus ;
`ghcr-pull-secret` doit être de type
`kubernetes.io/dockerconfigjson` et contenir `.dockerconfigjson`. Le script
refuse de déployer si un Secret, une clé ou le type du Secret GHCR manque.

#### Déployer et vérifier Prod

Utilisez le même SHA de 40 caractères hexadécimaux qui a déjà été déployé avec
succès en Test. Le script applique uniquement l'overlay Prod après vérification
des prérequis, fixe les deux images sur ce SHA, attend le rollout serveur/web,
puis affiche les Deployments, Pods, PVC et Ingress :

```bash
./infra/kubernetes/scripts/deploy.sh prod sha-<40-character-git-sha>
```

Remplacez l'exemple par le SHA réel ; le script demande une confirmation avant
de modifier le cluster. Pour Test, le même script accepte
`./infra/kubernetes/scripts/deploy.sh test sha-<40-character-git-sha>`, mais
la CI reste le chemin de déploiement normal et conserve sa migration préalable.

Après le déploiement, vérifiez également PostgreSQL et l'Ingress :

```bash
kubectl rollout status statefulset/clichy-postgres -n clichy-prod --timeout=300s
kubectl get deployments,statefulsets,pods,pvc,ingress -n clichy-prod -o wide
kubectl describe ingress clichy-web -n clichy-prod
curl -I https://valtask.xyz
```

Le script `deploy.sh` ne lance pas de migration Prisma. Appliquez les migrations
Prod avec la version approuvée avant de promouvoir un changement de schéma ;
ne réutilisez jamais les credentials de Test. Le Cloudflare Tunnel existant
transmet uniquement le trafic public de `valtask.xyz` vers Traefik HTTP sur le
port 80 (`web`), où Cloudflare termine HTTPS. Ne publiez pas Grafana, Headlamp,
PostgreSQL ni les interfaces de gestion Kubernetes dans le tunnel.

L'Ingress de Prod cible `valtask.xyz` sur l'entrypoint Traefik `web`, sans
Secret TLS Kubernetes. Une réponse `404` de Traefik signifie souvent que le
hostname ne correspond à aucune règle : contrôlez que l'Ingress `clichy-web`
est bien dans `clichy-prod` et que son host est exactement `valtask.xyz`.
Contrôlez aussi que le tunnel Cloudflare transmet vers le port 80 de Traefik.
Ne modifiez pas l'Ingress de Test pour résoudre un problème de host Prod.

Vérifier l'état réel de `valtask` avant l'application. L'ancien overlay Prod
demandait `50Gi` pour le volume PostgreSQL ; le nouvel overlay reprend la
demande `10Gi` de la base. Si un StatefulSet ou un PVC Prod existe déjà, ne pas
appliquer avant d'avoir comparé la taille et planifié la migration : un
`volumeClaimTemplate` existant est immuable et un PVC ne doit pas être recréé
pour réduire sa capacité.

```bash
kubectl get statefulset,pvc -n clichy-prod -o wide
kubectl get pv -o wide
kubectl describe node valtask
kubectl top node valtask
df -h /srv/clichy /var/lib/rancher/k3s/storage
```

L'overlay demande une seule réplique de chaque application et PostgreSQL,
conserve les requêtes/limites ainsi que les sondes du Deployment de base, et
utilise les PVC de 10Gi par défaut pour PostgreSQL et les photos. Prod n'a pas
d'HPA. Vérifier la capacité, les sauvegardes, les secrets et la stratégie de
migration ci-dessous avant d'autoriser la première promotion.

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
  `self-hosted` et `linux`. Avant toute migration ou application, le workflow
  vérifie que le cluster n'a qu'un nœud nommé `valtask`. Il utilise Node.js 24,
  pnpm, `kubectl` et le
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

Le workflow de déploiement Test ne référence aucun Secret GitHub additionnel.
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
curl -fsS -I http://clichy-test.home.arpa/
```

Dev n'est jamais déployé par ce workflow. Aucun job Prod n'est activé ; le
script manuel `deploy.sh` accepte Test ou Prod et un tag SHA Git complet, mais
ne réalise pas les migrations. Pour Test, laisser le workflow gérer les
migrations.

## Traefik, Ingress et vérification des URL

Les Ingress se trouvent dans ces namespaces :

```bash
kubectl get ingress -n clichy-test -o yaml
kubectl get ingress -n monitoring -o yaml
kubectl get ingress -n headlamp -o yaml
```

Le résultat attendu est Clichy Test `clichy-web` dans `clichy-test` sur `web`,
Grafana dans `monitoring` sur `grafana`, et Headlamp `headlamp-lan` dans
`headlamp` sur `headlamp`. L'Ingress de Prod, une fois déployé, utilise
l'entrypoint `web` et le host distinct `valtask.xyz`. Headlamp et son Service
partagent le namespace `headlamp`.

Depuis le serveur ou un client connecté au tailnet :

```bash
getent hosts valtask
tailscale ping valtask
curl -fsS -I http://clichy-test.home.arpa/
curl -fsS http://valtask:3000/api/health
curl -fsS -I http://valtask:4466/
```

Le endpoint de santé Grafana permet de vérifier son démarrage. Headlamp peut
rediriger vers sa page d'authentification. Un HTTP réussi ne signifie pas que
l'utilisateur est authentifié dans Headlamp/Grafana.

Pour diagnostiquer un Ingress qui ne répond pas, contrôler d'abord le host, la
règle et son entrypoint, puis les services et endpoints :

```bash
kubectl describe ingress clichy-web -n clichy-test
kubectl get services,endpoints -n clichy-test -o wide
kubectl logs -n kube-system deployment/traefik --tail=100
curl -v http://clichy-test.home.arpa/
```

Le host de Test doit seulement résoudre en DNS privé vers `valtask`. Le host
Prod `valtask.xyz` doit être routé par le tunnel Cloudflare vers le port 80 de
Traefik ; le tunnel et ses règles DNS ne sont pas gérés par ce dépôt.

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
10, Prometheus 10, Grafana 2), sans compter l'OS. Prod demande en plus `20Gi`
(PostgreSQL 10, photos 10), soit environ `52Gi` au total pour Test, Prod et le
monitoring. Le LV communiqué de 30 GB ne suffit pas à garantir ces demandes ;
vérifier la capacité réellement disponible sur le chemin `local-path`, réduire
ou déplacer les données de façon planifiée, ou agrandir le stockage avant
d'activer Prod. Ne pas réduire des PVC existants par modification de manifest.
L'ajout d'un namespace Dev rajoute ses propres volumes DB/photos.

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

## ReplicaSets et historique des rollouts

Les Deployments Server/Web déclarent `revisionHistoryLimit: 2`. Kubernetes
conserve le ReplicaSet actif et jusqu'à deux anciennes révisions pour permettre
un rollback ; les anciennes révisions à zéro réplique ne sont donc pas des
erreurs. Le contrôleur nettoie les anciennes révisions au fil des rollouts,
pas nécessairement dès l'application du nouveau manifeste.

Vérifier la limite, le propriétaire UID et les répliques avant toute conclusion :

```bash
kubectl get deployments -n clichy-test \
  -o custom-columns='NAME:.metadata.name,HISTORY:.spec.revisionHistoryLimit,UID:.metadata.uid'
kubectl get replicasets -n clichy-test \
  -o custom-columns='NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].name,OWNER-UID:.metadata.ownerReferences[0].uid,DESIRED:.spec.replicas,CURRENT:.status.replicas'
kubectl get pods -n clichy-test --show-labels
```

Comparer l'UID `OWNER-UID` au UID du Deployment et vérifier les Pods portant
les labels du ReplicaSet. Ne supprimer un ReplicaSet que si son ownerReference
est réellement absent ou invalide, qu'aucun Pod ne lui appartient et qu'il
n'est pas requis pour un rollback. Pour une ressource précise après ces
vérifications, examiner d'abord `kubectl describe rs <nom> -n <namespace>`;
ne pas supprimer en masse les ReplicaSets à zéro réplique.

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

Pour un PVC `Pending` ou un volume non monté, inspecter l'événement et le
StorageClass avant toute modification :

```bash
kubectl get pvc -n clichy-test -o wide
kubectl describe pvc <nom-du-pvc> -n clichy-test
kubectl get pv -o wide
kubectl describe pv <nom-du-pv>
kubectl get storageclass
```

Ne pas supprimer ni recréer le StatefulSet, son PVC ou un PV pour contourner
une erreur de stockage. Vérifier les `claimName`, le provisioner `local-path`,
l'espace disque et les événements ; toute migration ou extension de volume
doit être planifiée et sauvegardée.

Pour vérifier le runner :

```bash
sudo ./svc.sh status
sudo journalctl -u 'actions.runner*' --since '30 minutes ago' --no-pager
```

Le nom systemd exact est indiqué par `./svc.sh status`. Vérifier également
l'état Online/Idle du runner dans les paramètres GitHub du dépôt.

## Cloudflare Tunnel et exposition

Cloudflare Tunnel est configuré hors dépôt et doit router uniquement
`valtask.xyz` vers Traefik sur le port HTTP 80 (`web`). Cloudflare termine
HTTPS ; aucun certificat ni Secret TLS public n'est requis dans Kubernetes.
Rediriger `www.valtask.xyz` vers `https://valtask.xyz` au niveau Cloudflare,
sans ajouter une seconde règle applicative.

Grafana, Headlamp, Prometheus, Alertmanager, PostgreSQL et l'API Kubernetes
restent privés au cluster/tailnet. Ne pas ajouter de règle de tunnel ou
d'Ingress public pour ces services.
