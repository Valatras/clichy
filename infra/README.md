# Infrastructure Clichy

Le déploiement visé est un cluster K3s mono-nœud sur Ubuntu Server, avec
Traefik intégré, accès privé au tailnet Tailscale et images applicatives
publiées dans GHCR.

## État des composants

- **En place dans le dépôt :** images Docker de l'API et du frontend,
  manifests Kustomize, PostgreSQL, stockage photo sur PVC, configuration
  Traefik pour Clichy/Grafana/Headlamp, Helm pour le monitoring et Headlamp.
- **Automatisé :** CI et publication d'images par runner GitHub hébergé ;
  migrations et déploiement de Test par runner auto-hébergé.
- **Non intégré :** le volume LVM `/srv/clichy` signalé sur `valtask`. Les PVC
  utilisent le StorageClass Kubernetes `local-path` ; voir la section
  stockage du [guide K3s](./kubernetes/README.md#stockage-persistance-et-sauvegardes).
- **À venir :** exposition de la seule application via Cloudflare Tunnel et
  configuration d'un domaine/TLS. Aucun service d'administration ne doit
  devenir public.

Les scripts et guides de préparation d'un hôte Ubuntu ainsi que les commandes
de maintenance sont documentés dans le [guide d'installation K3s](./kubernetes/README.md).
