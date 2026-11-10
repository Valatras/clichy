#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
HEADLAMP_CHART_VERSION="0.46.0"

for command_name in helm kubectl python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "La commande requise '$command_name' est absente." >&2
    exit 1
  fi
done

ensure_helm_repo() {
  local name="$1"
  local url="$2"
  local configured_url

  configured_url="$(
    helm repo list --output json |
      python3 -c '
import json
import sys

repositories = json.load(sys.stdin)
name = sys.argv[1]
print(next((repo["url"] for repo in repositories if repo["name"] == name), ""))
' "$name"
  )"

  if [[ -z "$configured_url" ]]; then
    helm repo add "$name" "$url"
  elif [[ "$configured_url" != "$url" ]]; then
    echo "Le dépôt Helm '$name' pointe vers '$configured_url', pas '$url'." >&2
    echo "Inspectez sa configuration ; le script ne la remplacera pas." >&2
    exit 1
  fi
}

echo "Contexte Kubernetes : $(kubectl config current-context)"
kubectl get nodes
release_exists=false
if helm status headlamp --namespace headlamp >/dev/null 2>&1; then
  release_exists=true
fi

if [[ "$release_exists" == true &&
  "${ALLOW_HEADLAMP_UPGRADE:-false}" != "true" ]]; then
  echo "La release Headlamp existe déjà dans headlamp." >&2
  echo "Inspectez ses valeurs et son historique avant de confirmer leur remplacement." >&2
  echo "Relancez avec ALLOW_HEADLAMP_UPGRADE=true après cette vérification." >&2
  exit 1
fi

if [[ "$release_exists" == true ]]; then
  echo "La release Headlamp sera mise à niveau vers chart $HEADLAMP_CHART_VERSION avec les valeurs versionnées."
else
  echo "Ce script crée les namespaces Dev/Test et Headlamp, applique ses RBAC/Ingress et installe le chart $HEADLAMP_CHART_VERSION."
fi
read -r -p "Continuer sur le contexte Kubernetes affiché ? [y/N] " answer
if [[ ! "$answer" =~ ^[Yy]$ ]]; then
  echo "Opération annulée."
  exit 1
fi

ensure_helm_repo headlamp https://kubernetes-sigs.github.io/headlamp/
helm repo update headlamp
kubectl apply -f "$ROOT_DIR/infra/kubernetes/overlays/dev/namespace.yaml"
kubectl apply -f "$ROOT_DIR/infra/kubernetes/overlays/test/namespace.yaml"
stale_ingress="$(
  kubectl get ingress headlamp-lan \
    --namespace=default \
    --ignore-not-found \
    --output=name
)"
if [[ -n "$stale_ingress" ]]; then
  echo "Un ancien Ingress $stale_ingress existe dans default."
  echo "Il sera supprimé ; la nouvelle ressource est gérée dans namespace headlamp."
  read -r -p "Supprimer cet ancien Ingress ? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Opération annulée avant l'application des ressources Headlamp." >&2
    exit 1
  fi
  kubectl delete ingress headlamp-lan --namespace=default
fi

kubectl apply -k "$ROOT_DIR/infra/kubernetes/headlamp"
helm upgrade --install headlamp headlamp/headlamp \
  --namespace headlamp \
  --version "$HEADLAMP_CHART_VERSION" \
  --values "$ROOT_DIR/infra/kubernetes/headlamp/values.yaml" \
  --wait \
  --timeout 5m
kubectl get service headlamp -n headlamp
