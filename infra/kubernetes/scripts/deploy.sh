#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  echo "Usage: $0 test sha-<40-character-commit>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
ENVIRONMENT="$1"
IMAGE_TAG="$2"

case "$ENVIRONMENT" in
  test) ;;
  *) usage ;;
esac

if ! command -v kubectl >/dev/null 2>&1; then
  echo "La commande requise 'kubectl' est absente." >&2
  exit 1
fi

if [[ ! "$IMAGE_TAG" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "Le tag doit être sha- suivi du SHA Git complet (40 caractères hexadécimaux)." >&2
  exit 2
fi

NAMESPACE="clichy-${ENVIRONMENT}"
context="$(kubectl config current-context)"
node_names="$(kubectl get nodes \
  --output=jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')"
if [[ "$node_names" != "valtask" ]]; then
  printf "Refusing to deploy Test: expected the single node valtask, got:\n%s\n" \
    "$node_names" >&2
  exit 1
fi

echo "Déploiement de $IMAGE_TAG vers $NAMESPACE (contexte $context)."
read -r -p "Continuer ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

kubectl kustomize "$ROOT_DIR/infra/kubernetes/overlays/$ENVIRONMENT" |
  sed \
    -e "s|ghcr.io/valatras/clichy-server:test|ghcr.io/valatras/clichy-server:${IMAGE_TAG}|g" \
    -e "s|ghcr.io/valatras/clichy-web:test|ghcr.io/valatras/clichy-web:${IMAGE_TAG}|g" |
  kubectl apply -f -
kubectl rollout status deployment/clichy-server --namespace="$NAMESPACE" --timeout=300s
kubectl rollout status deployment/clichy-web --namespace="$NAMESPACE" --timeout=300s
kubectl get deployments,pods,pvc,ingress --namespace="$NAMESPACE"
