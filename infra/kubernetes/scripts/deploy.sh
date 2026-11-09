#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"

usage() {
  echo "Usage: $0 dev|test|prod sha-<commit>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
ENVIRONMENT="$1"
IMAGE_TAG="$2"

case "$ENVIRONMENT" in
  dev|test|prod) ;;
  *) usage ;;
esac

if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "Tag d'image invalide : $IMAGE_TAG" >&2
  exit 2
fi

NAMESPACE="clichy-${ENVIRONMENT}"
context="$(kubectl config current-context)"
echo "Déploiement de $IMAGE_TAG vers $NAMESPACE (contexte $context)."
read -r -p "Continuer ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

kubectl apply -k "$ROOT_DIR/infra/kubernetes/overlays/$ENVIRONMENT"
kubectl set image deployment/clichy-server \
  "server=ghcr.io/valatras/clichy-server:${IMAGE_TAG}" \
  --namespace="$NAMESPACE"
kubectl set image deployment/clichy-web \
  "web=ghcr.io/valatras/clichy-web:${IMAGE_TAG}" \
  --namespace="$NAMESPACE"
kubectl rollout status deployment/clichy-server --namespace="$NAMESPACE" --timeout=300s
kubectl rollout status deployment/clichy-web --namespace="$NAMESPACE" --timeout=300s
kubectl get deployments,pods,pvc,ingress --namespace="$NAMESPACE"
