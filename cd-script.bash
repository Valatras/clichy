# Saisir ton nom d'utilisateur GitHub
read -rp "GitHub username: " GHCR_USER

# Saisir le token sans l'afficher
read -rsp "GitHub PAT: " GHCR_TOKEN
echo

# Utiliser un fichier Docker temporaire
export DOCKER_CONFIG="$(mktemp -d)"

# Authentification auprès de GHCR
printf '%s' "$GHCR_TOKEN" |
  docker login ghcr.io \
    --username "$GHCR_USER" \
    --password-stdin

# Créer ou mettre à jour le secret Kubernetes
kubectl create secret generic ghcr-pull-secret \
  --namespace=clichy-test \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson="$DOCKER_CONFIG/config.json" \
  --dry-run=client -o yaml |
  kubectl apply -f -

# Nettoyer les identifiants temporaires
docker logout ghcr.io
rm -rf "$DOCKER_CONFIG"
unset DOCKER_CONFIG GHCR_USER GHCR_TOKEN