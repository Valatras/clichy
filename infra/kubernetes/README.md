# Déployer Clichy avec K3s

Ce guide décrit le déploiement mono-nœud visé pour un serveur domestique. Les
overlays Kustomize se trouvent dans `overlays/` :

| Environnement | Namespace | Usage |
| --- | --- | --- |
| `dev` | `clichy-dev` | Déploiement manuel et accès depuis le réseau local |
| `test` | `clichy-test` | Déploiement du workflow GitHub Actions, avec autoscaling |
| `prod` | `clichy-prod` | Exemple incomplet : domaine et TLS fictifs à remplacer |

Un seul nœud K3s et ses volumes `local-path` ne fournissent ni haute
disponibilité ni sauvegarde. PostgreSQL et les photos ont chacun un stockage
persistant local ; prévoir une stratégie de sauvegarde avant d'y confier les
seules copies de fichiers.

## 1. Installer et vérifier K3s

Sur le serveur Linux, installer K3s depuis son canal officiel :

```bash
curl -sfL https://get.k3s.io | sh -
```

Préparer un kubeconfig utilisateur et vérifier le cluster :

```bash
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"
kubectl get nodes
kubectl get storageclass
kubectl get pods -n kube-system
```

Le kubeconfig K3s donne des droits administrateur sur le cluster : le protéger
et ne pas le committer. K3s installe normalement Traefik et le StorageClass
`local-path`, attendus par les manifests Clichy.

## 2. Installer Helm et les outils d'administration

Le script Helm prend en charge Debian et Ubuntu. Les scripts doivent être
exécutés depuis la racine du dépôt :

```bash
./infra/kubernetes/scripts/install-helm.sh
./infra/kubernetes/scripts/install-monitoring.sh
```

Le second script installe `kube-prometheus-stack` dans le namespace
`monitoring`, avec des valeurs adaptées à un petit cluster, puis applique le
dashboard, les règles et le `ServiceMonitor` Clichy. La version Helm est fixée
à `93.1.1` ; pour en choisir une autre, définir
`PROMETHEUS_STACK_CHART_VERSION` avant l'exécution. Si une release
`prometheus-stack` existe déjà, le script s'arrête pour éviter d'écraser ses
valeurs silencieusement. Après avoir examiné `helm get values prometheus-stack
-n monitoring --all`, confirmer explicitement une mise à niveau avec
`ALLOW_PROMETHEUS_UPGRADE=true`.

Headlamp est facultatif. Il offre une interface d'administration Kubernetes,
mais son compte a des droits d'administration sur les namespaces Clichy. Ne
pas exposer son service sur Internet :

```bash
./infra/kubernetes/scripts/install-headlamp.sh
kubectl port-forward -n headlamp svc/headlamp 4466:80
```

Ouvrir `http://localhost:4466`. Des instructions détaillées sur Headlamp, le
monitoring et le dépannage sont également dans
[`administrator_headlamp_guide.md`](./administrator_headlamp_guide.md).

## 3. Préparer les secrets d'un namespace

Avant le premier déploiement, créer les secrets pour l'environnement voulu :

```bash
./infra/kubernetes/scripts/prepare-namespace.sh test
```

Le script crée `clichy-server-secrets` et `ghcr-pull-secret` dans le namespace
choisi. Il garde le fichier local sous `$HOME/.config/clichy/` avec des droits
restreints et demande un jeton GitHub autorisé à lire les paquets GHCR
`clichy-server` et `clichy-web`. Il crée aussi le StatefulSet PostgreSQL et
attend que la base soit prête ; le workflow de déploiement peut ainsi appliquer
les migrations avant le premier rollout. Ne jamais committer le fichier de
secrets ni afficher le jeton dans les logs.

Les clés applicatives attendues sont `DATABASE_URL`, `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD` et `BETTER_AUTH_SECRET`. Le script génère
une clé d'authentification ; choisir un mot de passe PostgreSQL et encoder ses
caractères réservés dans l'URL de connexion. Les noms de base utilisés sont
`clichy_dev`, `clichy_test` et `clichy_prod`. Changer `POSTGRES_DB` ne crée pas
une nouvelle base sur un volume PostgreSQL déjà initialisé.

Le fichier `server_secrets.yaml` à la racine de ce dossier est ignoré par Git
et contient des valeurs de démonstration : ne pas l'utiliser comme secret de
serveur.

## 4. Déployer après un push

Le workflow `.github/workflows/ci.yml` est configuré pour :

1. lancer la vérification des types, les tests et le build ;
2. publier les images `ghcr.io/valatras/clichy-server` et
   `ghcr.io/valatras/clichy-web` avec un tag `sha-<commit>` ;
3. sur un push vers `master`, appliquer les migrations à Test puis déployer les
   nouvelles images dans `clichy-test`.

Le job de déploiement exige un runner GitHub Actions auto-hébergé portant les
labels `self-hosted` et `linux`, sur le serveur ou une machine qui peut joindre
le cluster. Il doit disposer de Node.js/pnpm, Docker, `kubectl` et du kubeconfig
du cluster. Ce runner peut déployer du code sur le serveur : ne pas exécuter de
workflows non fiables sur cette machine.

Après avoir installé Prometheus et exécuté `prepare-namespace.sh test`,
enregistrer/configurer le runner selon les instructions GitHub, puis pousser
sur `master`. Le déploiement Test peut être vérifié avec :

```bash
kubectl get deployments,pods,pvc -n clichy-test
kubectl get hpa -n clichy-test
kubectl rollout status deployment/clichy-server -n clichy-test
kubectl rollout status deployment/clichy-web -n clichy-test
```

Les déploiements `dev` et `prod` ne sont pas effectués par ce workflow. Pour
promouvoir manuellement une image déjà publiée vers Dev :

```bash
./infra/kubernetes/scripts/prepare-namespace.sh dev
./infra/kubernetes/scripts/deploy.sh dev sha-<sha-du-commit>
```

Le script de déploiement applique l'overlay, met à jour les deux images et
attend leur disponibilité. Il n'exécute pas de migration de base de données.
Pour Test, laisser le workflow gérer les migrations ; avant un déploiement
manuel ailleurs, appliquer les migrations compatibles explicitement.

## Migrations Prisma avant la première installation

Le workflow utilise `prisma migrate deploy`, qui n'applique que les migrations
commitées. Le dépôt ne contient actuellement pas encore de migration SQL
initiale : créer et committer la première migration avant le premier push de
déploiement, par exemple depuis un environnement local de développement avec
PostgreSQL démarré :

```bash
pnpm run db:migrate
git add packages/db/prisma/migrations
git commit
```

Ne pas utiliser `db:push` pour initialiser une base persistante ; voir le guide
[`packages/db/README.md`](../../packages/db/README.md).

## Accès au réseau local et futur tunnel

L'Ingress K3s utilise Traefik et des hôtes de développement, par exemple
`clichy-test.localhost`. Depuis un autre ordinateur, `localhost` désigne cet
ordinateur et non le serveur. Pour un essai LAN, utiliser une entrée DNS locale
ou un nom résolu vers l'adresse LAN du serveur, puis remplacer l'hôte de
l'Ingress et `BETTER_AUTH_URL`/`CORS_ORIGIN` dans l'overlay correspondant.

Le dépôt ne configure pas Cloudflare Tunnel. Pour l'étape ultérieure, faire
pointer le tunnel vers l'Ingress Traefik et mettre à jour ensemble le nom
d'hôte, les URL d'authentification/CORS et le TLS selon le mode retenu. Ne pas
exposer les ports `6443` (Kubernetes), `5432` (PostgreSQL), `9090` (Prometheus)
ou `4466` (Headlamp) à Internet.

## Vérifications et accès aux outils

```bash
kubectl get servicemonitor,prometheusrule -n monitoring
kubectl port-forward -n monitoring svc/prometheus-stack-grafana 3000:80
```

Ouvrir `http://localhost:3000` et choisir le dashboard **Clichy Photo
Service**. Le serveur expose `/metrics` uniquement dans le cluster ; cette
route ne doit pas être ajoutée à l'Ingress public. Headlamp utilise Metrics
Server pour l'état courant et le HPA ; Prometheus collecte des séries
temporelles pour Grafana et les alertes.

Pour les manifestes, l'autoscaling Test et les diagnostics plus avancés, voir
[`INFRASTRUCTURE_REVIEW.md`](./INFRASTRUCTURE_REVIEW.md) et
[`administrator_headlamp_guide.md`](./administrator_headlamp_guide.md).
