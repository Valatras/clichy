# Infrastructure Clichy

Le déploiement visé est un cluster K3s mono-nœud sur Ubuntu Server, avec
Traefik intégré, Test et administration privés sur Tailscale, Prod via
Cloudflare Tunnel, et images applicatives publiées dans GHCR.

## État des composants

- **En place dans le dépôt :** images Docker de l'API et du frontend,
  manifests Kustomize, PostgreSQL, stockage photo sur PVC, configuration
  Traefik pour Clichy/Grafana/Headlamp, Helm pour le monitoring et Headlamp.
- **Automatisé :** CI et publication d'images par runner GitHub hébergé ;
  migrations puis déploiement de Test et de Prod par le runner auto-hébergé.
- **Non intégré :** le volume LVM `/srv/clichy` signalé sur `valtask`. Les PVC
  utilisent le StorageClass Kubernetes `local-path` ; voir la section
  stockage du [guide K3s](./kubernetes/README.md#stockage-persistance-et-sauvegardes).
- **Accès public :** Cloudflare Tunnel est configuré hors dépôt pour la seule
  application de production à `https://valtask.xyz`. Le tunnel transmet HTTP à
  Traefik (`web`) ; aucun Secret TLS Kubernetes n'est requis. Aucun service
  d'administration ne doit devenir public.

Les namespaces `clichy-dev`, `clichy-test` et `clichy-prod` sont des frontières
logiques, pas des clusters distincts. Dev se déploie uniquement sur un cluster
local. Test et Prod ciblent `valtask`; Test reste privé au LAN/Tailscale sur
`clichy-test.home.arpa`, et Prod est la seule application exposée publiquement.
Sur un push validé vers `master`, la CI publie des images taguées par le SHA,
applique d'abord les migrations et déploie Test, puis attend l'approbation du
GitHub Environment protégé `production` avant de migrer et déployer le même
SHA en Prod. Les pull requests ne déploient jamais sur le runner.

Les scripts et guides de préparation d'un hôte Ubuntu ainsi que les commandes
de maintenance sont documentés dans le [guide d'installation K3s](./kubernetes/README.md).
