# Infrastructure

L'infrastructure de Clichy vise un serveur Linux mono-nœud :

- [`docker_clichy_server/`](./docker_clichy_server/) construit l'image Node.js
  de l'API.
- [`docker_clichy_web/`](./docker_clichy_web/) construit le serveur web React
  Router.
- [`kubernetes/`](./kubernetes/README.md) contient les overlays Kustomize,
  les scripts d'installation et les procédures de déploiement K3s.
- [`nfs/`](./nfs/) contient des scripts d'exemple pour un serveur NFS local ;
  ils ne sont pas requis avec les volumes locaux par défaut de K3s.

Les images de production sont construites par GitHub Actions et publiées dans
GHCR. Le pipeline déploie actuellement l'environnement Test seulement. La
configuration `prod` est un point de départ, pas un déploiement prêt pour un
nom de domaine : remplacer son hôte fictif, préparer le TLS et vérifier le
stockage avant de l'utiliser.

Pour le premier déploiement sur un serveur domestique, suivre le
[guide K3s](./kubernetes/README.md). Il décrit K3s, Helm, Prometheus, les
secrets GHCR/Kubernetes et le runner auto-hébergé.
